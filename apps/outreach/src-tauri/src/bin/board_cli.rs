//! `board-cli` — reads one `{verb, args}` JSON request from stdin, calls the
//! matching `outreach_app_lib::board` verb (gates enforced there, once), and
//! prints one `{ok:true, data}` / `{ok:false, error}` JSON response to
//! stdout. Exit code is 0 even for a verb-level error (the error is in the
//! JSON); non-zero is reserved for malformed input, missing project, DB-open
//! failure, or an unknown verb.
//!
//! The project's DB is `"$OUTREACH_PROJECT"/board.db`.

use std::io::Read as _;

use outreach_app_lib::board::{self, LeadFilter};
use rusqlite::Connection;
use serde_json::{json, Value};

/// Dispatch one `{verb, args}` request against an already-open connection.
/// Kept separate from `main` so it's unit-testable without spawning a
/// process or touching stdio.
pub fn dispatch(c: &Connection, verb: &str, args: &Value) -> Result<Value, String> {
    let get_str = |name: &str| -> Result<String, String> {
        args.get(name)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("config: missing arg {name}"))
    };
    let get_i64 = |name: &str| -> Result<i64, String> {
        args.get(name)
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("config: missing arg {name}"))
    };
    let get_bool = |name: &str| -> Result<bool, String> {
        args.get(name)
            .and_then(Value::as_bool)
            .ok_or_else(|| format!("config: missing arg {name}"))
    };
    let get_opt_str = |name: &str| -> Option<String> {
        args.get(name).and_then(Value::as_str).map(str::to_string)
    };

    match verb {
        "listStages" => board::list_stages_json(c).map(|data| json!({"ok": true, "data": data})),
        "listLeads" => board::list_leads_json(c).map(|data| json!({"ok": true, "data": data})),
        "getLead" => {
            let id = get_str("id")?;
            board::get_lead_json(c, &id).map(|data| json!({"ok": true, "data": data}))
        }
        "listRules" => board::list_rules_json(c).map(|data| json!({"ok": true, "data": data})),
        "getConfig" => board::get_config_json(c).map(|data| json!({"ok": true, "data": data})),
        "addLead" => {
            let name = get_str("name")?;
            let org = get_opt_str("org");
            let stage = get_str("stage")?;
            match board::add_lead(c, &name, org.as_deref(), &stage, "local") {
                Ok(id) => Ok(json!({"ok": true, "data": {"id": id}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "moveLead" => {
            let id = get_str("id")?;
            let to_stage = get_str("toStage")?;
            let expected_version = get_i64("expectedVersion")?;
            match board::move_lead(c, &id, &to_stage, expected_version) {
                Ok(version) => Ok(json!({"ok": true, "data": {"version": version}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "appendContext" => {
            let id = get_str("id")?;
            let research = args
                .get("research")
                .cloned()
                .ok_or_else(|| "config: missing arg research".to_string())?;
            let expected_version = get_i64("expectedVersion")?;
            match board::append_context(c, &id, research, expected_version) {
                Ok(seq) => Ok(json!({"ok": true, "data": {"seq": seq}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "draftMessage" => {
            let id = get_str("id")?;
            let msg = args
                .get("msg")
                .cloned()
                .ok_or_else(|| "config: missing arg msg".to_string())?;
            match board::draft_message(c, &id, msg) {
                Ok(seq) => Ok(json!({"ok": true, "data": {"seq": seq}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "attachTranscript" => {
            let id = get_str("id")?;
            let raw = get_str("raw")?;
            let summary = get_str("summary")?;
            match board::attach_transcript(c, &id, &raw, &summary) {
                Ok(seq) => Ok(json!({"ok": true, "data": {"seq": seq}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "renameStage" => {
            let id = get_str("id")?;
            let label = get_str("label")?;
            match board::rename_stage(c, &id, &label) {
                Ok(version) => Ok(json!({"ok": true, "data": {"version": version}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "reorderStages" => {
            let ids = args
                .get("ids")
                .and_then(Value::as_array)
                .ok_or_else(|| "config: missing arg ids".to_string())?
                .iter()
                .map(|v| v.as_str().ok_or_else(|| "config: ids must be strings".to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            match board::reorder_stages(c, &ids) {
                Ok(()) => Ok(json!({"ok": true, "data": {"ok": true}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "addStage" => {
            let label = get_str("label")?;
            let position = get_i64("position")?;
            match board::add_stage(c, &label, position, "local") {
                Ok(id) => Ok(json!({"ok": true, "data": {"id": id}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "retireStage" => {
            let id = get_str("id")?;
            match board::retire_stage(c, &id) {
                Ok(seq) => Ok(json!({"ok": true, "data": {"seq": seq}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "unretireStage" => {
            let id = get_str("id")?;
            match board::unretire_stage(c, &id) {
                Ok(seq) => Ok(json!({"ok": true, "data": {"seq": seq}})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        "remapStage" => {
            let from = get_str("from")?;
            let to = get_str("to")?;
            let org_filter = get_opt_str("orgFilter");
            let dry_run = get_bool("dryRun")?;
            let retire_source = get_bool("retireSource")?;
            let confirmed = get_bool("confirmed")?;
            let filter = org_filter.map(|org| LeadFilter { org: Some(org) });
            match board::remap_stage(c, &from, &to, filter, dry_run, retire_source, confirmed) {
                Ok(result) => Ok(json!({"ok": true, "data": {
                    "affected": result.affected,
                    "leadIds": result.lead_ids,
                }})),
                Err(e) => Ok(json!({"ok": false, "error": board::board_err(e)})),
            }
        }
        other => Err(format!("config: unknown verb {other}")),
    }
}

fn main() {
    let project = match std::env::var("OUTREACH_PROJECT") {
        Ok(p) => p,
        Err(_) => {
            print_and_exit_err("config: OUTREACH_PROJECT not set or board.db unopenable: OUTREACH_PROJECT is unset");
        }
    };
    let db_path = std::path::PathBuf::from(&project).join("board.db");
    let c = match board::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            print_and_exit_err(&format!(
                "config: OUTREACH_PROJECT not set or board.db unopenable: {e}"
            ));
        }
    };

    let mut input = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut input) {
        print_and_exit_err(&format!("config: failed to read stdin: {e}"));
    }

    let request: Value = match serde_json::from_str(&input) {
        Ok(v) => v,
        Err(e) => {
            print_and_exit_err(&format!("config: invalid JSON request: {e}"));
        }
    };

    let verb = match request.get("verb").and_then(Value::as_str) {
        Some(v) => v,
        None => {
            print_and_exit_err("config: missing arg verb");
        }
    };
    let args = request.get("args").cloned().unwrap_or(json!({}));

    match dispatch(&c, verb, &args) {
        Ok(response) => {
            println!("{response}");
        }
        Err(e) => {
            print_and_exit_err(&e);
        }
    }
}

/// Print a `{ok:false, error}` response to stdout and exit 1. Used for
/// malformed input / missing project / DB-open / unknown-verb failures,
/// which are distinct from verb-level `BoardError`s (those print via the
/// normal `dispatch` `Ok` path with exit 0).
fn print_and_exit_err(msg: &str) -> ! {
    println!("{}", json!({"ok": false, "error": msg}));
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seeded_conn() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        board::init(&c).unwrap();
        c
    }

    #[test]
    fn list_stages_returns_five_bootstrap_stages() {
        let c = seeded_conn();
        let resp = dispatch(&c, "listStages", &json!({})).unwrap();
        assert_eq!(resp["ok"], true);
        assert_eq!(resp["data"].as_array().unwrap().len(), 5);
    }

    #[test]
    fn add_lead_then_list_leads_shows_the_lead() {
        let c = seeded_conn();
        let add = dispatch(&c, "addLead", &json!({"name": "Ana Costa", "org": "Acme", "stage": "researching"})).unwrap();
        assert_eq!(add["ok"], true);
        let id = add["data"]["id"].as_str().unwrap().to_string();

        let list = dispatch(&c, "listLeads", &json!({})).unwrap();
        assert_eq!(list["ok"], true);
        let leads = list["data"].as_array().unwrap();
        assert!(leads.iter().any(|l| l["id"] == id));
    }

    #[test]
    fn remap_stage_dry_run_reports_affected_and_writes_nothing() {
        let c = seeded_conn();
        for _ in 0..2 {
            dispatch(&c, "addLead", &json!({"name": "X", "stage": "researching"})).unwrap();
        }
        let resp = dispatch(&c, "remapStage", &json!({
            "from": "researching", "to": "warm", "dryRun": true,
            "retireSource": false, "confirmed": false,
        })).unwrap();
        assert_eq!(resp["ok"], true);
        assert!(resp["data"]["affected"].as_i64().unwrap() > 0);

        // no write occurred: re-list, counts unchanged.
        let list = dispatch(&c, "listLeads", &json!({})).unwrap();
        let still_researching = list["data"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|l| l["stage"] == "researching")
            .count();
        assert_eq!(still_researching, 2);
    }

    #[test]
    fn remap_stage_over_five_without_confirm_needs_confirm() {
        let c = seeded_conn();
        for _ in 0..6 {
            dispatch(&c, "addLead", &json!({"name": "X", "stage": "researching"})).unwrap();
        }
        let resp = dispatch(&c, "remapStage", &json!({
            "from": "researching", "to": "warm", "dryRun": false,
            "retireSource": false, "confirmed": false,
        })).unwrap();
        assert_eq!(resp["ok"], false);
        assert!(resp["error"].as_str().unwrap().starts_with("needs-confirm:"));
    }
}
