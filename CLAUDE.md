# KineticType

## Gotchas

### Moving the project directory breaks the Rust build cache

`src-tauri/target/` caches absolute paths. If the project is moved or renamed, `npm run tauri:dev` fails with errors like:

```
failed to read plugin permissions: failed to read file '/old/path/.../tauri-...'
```

Fix: `cargo clean --manifest-path src-tauri/Cargo.toml` (or `rm -rf src-tauri/target`), then rebuild.

The cache itself is normal and healthy at ~2–10 GB — don't clear it routinely. Only after a move.
