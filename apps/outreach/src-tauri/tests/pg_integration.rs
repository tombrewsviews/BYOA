//! Env-gated Postgres integration tests for the Outreach board.
//!
//! Runs ONLY when `OUTREACH_TEST_PG` is set to a real Postgres URL (the
//! target is a Neon pooled endpoint — see the task notes). Unset → every
//! phase is skipped and the test passes, so the normal suite stays green
//! without a DB.
//!
//! One `#[test] fn pg_integration()` runs three phases SEQUENTIALLY (not
//! three separate `#[test]` fns): Rust runs `#[test]` fns concurrently, and
//! all phases share the `public` schema (the Neon pooler rejects
//! `options=-csearch_path=...`, and `open_board` seeds during connect before
//! a runtime `set search_path` could apply — so per-test schema isolation
//! isn't available through the `Db` seam). Each phase resets `public` first.

// NOTE: `outreach_app_lib::db` is a private module (only `mod db;` in
// lib.rs, not `pub mod`), and `board.rs` only re-exports `Db` itself
// (`pub use crate::db::Db;`) — not `SqlParam` or `DbError`. So this file
// uses ONLY `Db::connect_pg`/`db.exec`/`db.query_opt` (methods on the public
// `Db` type, callable with the empty param slice `&[]`, which needs no
// `SqlParam` import to type-check) plus `board`'s public JSON helpers
// (`list_stages_json`, `get_config_json`, `get_lead_json`) for reads that
// would otherwise need a `SqlParam`-typed bind parameter. See the report for
// details — this is a real, intentional gap in the public seam, not an
// oversight.
use outreach_app_lib::board::{self, Actor, BoardError, Db};

fn pg_url() -> Option<String> {
    std::env::var("OUTREACH_TEST_PG").ok().filter(|s| !s.trim().is_empty())
}

/// Drop all 6 outreach tables so the next `open_board` starts fresh.
/// Uses the `Db` seam only (no new deps, no bind params needed).
/// `cascade` handles FK order.
fn reset_public(url: &str) {
    let mut db = Db::connect_pg(url).expect("connect for reset");
    db.exec("drop table if exists rules, events, board_config, leads, stages, actors cascade", &[])
        .expect("reset public");
}

fn local_actor() -> Actor {
    Actor { id: "local".into(), label: "You".into() }
}

/// Number of stages, via the public `list_stages_json` helper (avoids
/// needing `SqlParam`/raw `count(*)` queries, which aren't reachable from
/// outside the crate).
fn stage_count(db: &mut Db) -> usize {
    board::list_stages_json(db).unwrap().as_array().unwrap().len()
}

/// `stage` field of a lead, via the public `get_lead_json` helper.
fn lead_stage(db: &mut Db, id: &str) -> String {
    board::get_lead_json(db, id).unwrap()["stage"].as_str().unwrap().to_string()
}

#[test]
fn pg_integration() {
    let Some(url) = pg_url() else {
        eprintln!("skipped: OUTREACH_TEST_PG unset");
        return;
    };
    let tmp = tempfile::TempDir::new().unwrap(); // open_board needs a project dir arg even for PG

    // ---- Phase 1: acceptance lifecycle (mirror board.rs's
    // `acceptance_stage_lifecycle_and_revert`, translated to Postgres) ----
    reset_public(&url);
    {
        let mut db = board::open_board(tmp.path(), Some(&url), &local_actor()).unwrap();
        // Seeded state: 5 default stages + 1 board_config row.
        assert_eq!(stage_count(&mut db), 5);
        board::get_config_json(&mut db).expect("board_config row must exist");

        // Create a stage, move four cards into it.
        let sid = board::add_stage(&mut db, "Follow up", 5, "local").unwrap();
        assert_eq!(sid, "follow-up");
        let mut lead_ids = Vec::new();
        for name in ["A", "B", "C", "D"] {
            // add_lead (public verb) seeds a lead at version 1 in "researching".
            let id = board::add_lead(&mut db, name, None, "researching", "local").unwrap();
            board::move_lead(&mut db, &id, &sid, 1, "local").unwrap(); // researching(v1) -> follow-up(v2)
            lead_ids.push(id);
        }

        // Rename it twice, reorder it.
        board::rename_stage(&mut db, &sid, "Chasing", "local").unwrap();
        // Watermark BEFORE the merge (this rename's own seq): everything
        // after this point is what the revert below undoes. `rename_stage`
        // returns the committed event's seq, so no raw `max(seq)` query
        // (which would need `SqlParam`) is needed.
        let watermark = board::rename_stage(&mut db, &sid, "Nudging", "local").unwrap();
        board::reorder_stages(
            &mut db,
            &["researching", "follow-up", "ready_to_contact", "contacted", "warm", "won"],
            "local",
        )
        .unwrap();

        // A rule references it — merge must be BLOCKED until remapped. No
        // public verb creates rules, so this uses `db.exec` with the JSON
        // condition inlined as a SQL literal (no `SqlParam` bind needed —
        // `db.exec`'s params slice is just `&[]` here).
        db.exec(
            "insert into rules(id,name,enabled,conditions,action) values('r','chase_rule',1,'{\"stage\":\"follow-up\"}','propose')",
            &[],
        )
        .unwrap();
        let blocked = board::remap_stage(&mut db, "follow-up", "won", None, false, true, true, "local");
        assert!(matches!(blocked, Err(BoardError::RuleBlocked(_))), "expected RuleBlocked, got {blocked:?}");

        // Remap the rule's reference away, then the merge succeeds.
        db.exec("update rules set conditions='{\"stage\":\"won\"}' where id='r'", &[]).unwrap();

        let r = board::remap_stage(&mut db, "follow-up", "won", None, false, true, true, "local").unwrap();
        assert_eq!(r.affected, 4);
        for id in &lead_ids {
            assert_eq!(lead_stage(&mut db, id), "won");
        }

        // revert the merge -> all four back to follow-up.
        board::revert(&mut db, watermark).unwrap();
        for id in &lead_ids {
            assert_eq!(lead_stage(&mut db, id), "follow-up");
        }
    }

    // ---- Phase 2: optimistic version conflict across two Pg handles ----
    reset_public(&url);
    {
        let mut a = board::open_board(tmp.path(), Some(&url), &local_actor()).unwrap();
        // seed a lead to move
        let id = board::add_lead(&mut a, "Ada", None, "researching", "local").unwrap();
        // handle B is a SEPARATE connection to the SAME shared board
        let mut b = board::open_board(tmp.path(), Some(&url), &local_actor()).unwrap();
        // A moves it at version 1 → now version 2
        board::move_lead(&mut a, &id, "contacted", 1, "local").unwrap();
        // B tries to move with the STALE version 1 → must be VersionConflict
        let err = board::move_lead(&mut b, &id, "warm", 1, "local").unwrap_err();
        assert!(matches!(err, BoardError::VersionConflict), "stale move must conflict, got {err:?}");
    }

    // ---- Phase 3: race-safe seed — two concurrent open_board on a fresh DB ----
    reset_public(&url);
    {
        let u1 = url.clone();
        let u2 = url.clone();
        let t1 = std::thread::spawn(move || {
            let d = tempfile::TempDir::new().unwrap();
            board::open_board(d.path(), Some(&u1), &local_actor()).map(|_| ()).map_err(|e| e.to_string())
        });
        let t2 = std::thread::spawn(move || {
            let d = tempfile::TempDir::new().unwrap();
            board::open_board(d.path(), Some(&u2), &local_actor()).map(|_| ()).map_err(|e| e.to_string())
        });
        t1.join().unwrap().expect("open_board 1");
        t2.join().unwrap().expect("open_board 2");
        // Exactly 5 stages + 1 board_config despite two concurrent seeders (advisory lock + on-conflict).
        let mut db = board::open_board(tmp.path(), Some(&url), &local_actor()).unwrap();
        assert_eq!(stage_count(&mut db), 5, "seed race must not duplicate stages");
        board::get_config_json(&mut db).expect("seed race must leave exactly one board_config row");
    }

    // Best-effort teardown so the shared DB is left clean for the next run.
    reset_public(&url);
}
