//! Semantic (AI) data operators — run a batched op over sampled rows via the
//! user's own agent CLI (claude -p). BYOA, no new credentials.

use serde_json::Value;

pub fn build_prompt(
    op: &str, instruction: &str, labels: &[String],
    input_col: &str, output_col: &str, rows: &[Value],
) -> String {
    let mut s = String::new();
    s.push_str("You are a precise data operator. ");
    match op {
        "classify" => {
            s.push_str(&format!(
                "Classify each item. Allowed labels: {}. ", labels.join(", ")));
        }
        "filter" => {
            s.push_str("Decide for each item whether it matches the instruction (true/false). ");
        }
        "extract" => { s.push_str("Extract the requested value from each item. "); }
        "label" => { s.push_str("Produce a short label for each item. "); }
        _ => { s.push_str("Process each item. "); }
    }
    s.push_str(&format!("Instruction: {instruction}\n"));
    s.push_str(&format!(
        "Input column: {input_col}. For EACH of the {} items below, return one JSON object \
         {{\"{output_col}\": <value>}}",
        rows.len()));
    if op == "filter" { s.push_str(" where <value> is a boolean"); }
    s.push_str(&format!(
        ". Return ONLY a JSON array of exactly {} objects, in the same order, no prose.\n\nItems:\n",
        rows.len()));
    for (i, r) in rows.iter().enumerate() {
        let v = r.get(input_col).cloned().unwrap_or(Value::Null);
        s.push_str(&format!("{}. {}\n", i + 1, v));
    }
    s
}

pub fn parse_response(text: &str, output_col: &str, n: usize) -> Result<Vec<Value>, String> {
    let start = text.find('[').ok_or("no JSON array in model output")?;
    let end = text.rfind(']').ok_or("no JSON array end in model output")?;
    if end < start { return Err("malformed JSON array in model output".into()); }
    let arr: Vec<Value> = serde_json::from_str(&text[start..=end])
        .map_err(|e| format!("parse model JSON: {e}"))?;
    if arr.len() != n {
        return Err(format!("model returned {} items, expected {}", arr.len(), n));
    }
    Ok(arr.into_iter()
        .map(|o| o.get(output_col).cloned().unwrap_or(Value::Null))
        .collect())
}

pub fn run_semantic(
    input_values: Vec<Value>, op: &str, instruction: &str, labels: &[String],
    input_col: &str, output_col: &str,
) -> Result<Vec<Value>, String> {
    // Wrap each input value as an object keyed by input_col so build_prompt is uniform.
    let rows: Vec<Value> = input_values.into_iter()
        .map(|v| serde_json::json!({ input_col: v })).collect();
    let n = rows.len();
    if n == 0 { return Ok(vec![]); }
    let prompt = build_prompt(op, instruction, labels, input_col, output_col, &rows);

    let mut cmd = std::process::Command::new("claude");
    cmd.args(["-p", "--output-format", "text", &prompt]);
    for (k, v) in std::env::vars() { cmd.env(k, v); }
    cmd.stdin(std::process::Stdio::null());
    let output = cmd.output()
        .map_err(|e| format!("could not run the agent CLI (claude): {e}. Is it installed?"))?;
    if !output.status.success() {
        return Err(format!("agent CLI failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    parse_response(&text, output_col, n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn build_prompt_includes_labels_and_count() {
        let rows = vec![json!({"body": "great"}), json!({"body": "awful"})];
        let p = build_prompt("classify", "sentiment", &["pos".into(), "neg".into()],
            "body", "sent", &rows);
        assert!(p.contains("pos, neg"));
        assert!(p.contains("exactly 2 objects"));
        assert!(p.contains("great"));
        assert!(p.contains("\"sent\""));
    }

    #[test]
    fn parse_response_extracts_values_in_order() {
        let text = "Sure! Here you go:\n[{\"sent\":\"pos\"},{\"sent\":\"neg\"}]\nDone.";
        let vals = parse_response(text, "sent", 2).unwrap();
        assert_eq!(vals, vec![json!("pos"), json!("neg")]);
    }

    #[test]
    fn parse_response_rejects_wrong_count() {
        let text = "[{\"sent\":\"pos\"}]";
        assert!(parse_response(text, "sent", 2).is_err());
    }
}
