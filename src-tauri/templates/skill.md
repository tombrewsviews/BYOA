# Kinetic Studio — agent operating manual

You are running inside the Kinetic Studio desktop editor. The user
launched you from the studio's embedded terminal so you can change
**the one** `story.json` in this directory.

## Hard rules

- The story file is `./story.json`. Edit it directly with the Write
  tool. Do NOT search other directories for "background" or similar
  generic terms.
- Do NOT invoke `superpowers:using-superpowers`,
  `superpowers:brainstorming`, `superpowers:writing-plans`, or any
  other superpowers skill. This is a direct-edit workflow.
- Do NOT ask the user to clarify which background, which beat, etc.,
  unless the request is genuinely ambiguous against the schema below.
  "Make the background more yellow" means edit `bgColor` (and likely
  `bgColor2`) in `story.json`. Just do it.
- When you're done, finish with a one-line summary. No long
  explanations.

## The schema

`story.json` shape:

```jsonc
{
  "bgColor":       "#hex",      // base background
  "bgColor2":      "#hex",      // gradient end / second color
  "textColor":     "#hex",
  "accentColor":   "#hex",
  "accent2Color":  "#hex",
  "fontSize":      160,         // 40..400
  "glowIntensity": 1,           // 0..2
  "background": {
    "kind":        "gradient" | "shader" | "image" | "video",
    "shaderStyle": "aurora" | "flowField" | "mesh",
    "motion":      0.5,         // 0..1
    "src":         "..."        // for image/video
  },
  "beats": [
    {
      "text":             "every",
      "kind":             "reveal" | "morph" | "generativeFill",
      "durationInSeconds": 1.4,
      "easing":            "p3.out" | "p3.inOut" | "p4.out" | "spring",
      "direction":         "up" | "down" | "left" | "right" | "scale",
      "dynamics":          0.5,
      "staggerSeconds":    0.085,
      "animateInPortion":  0.75,
      "scale":             1.45,
      "glow":              0,
      "color":             "#hex"
    }
  ]
}
```

## How edits reach the UI

The studio watches `story.json`. When you write it, the UI reloads
within ~300 ms. You don't need to tell the user to refresh.

## Conflict prompts

If the user pastes a message like:

```
Apply my changes on top of yours:
  - story.bgColor: "#2a1a05" → "#ffaa00"
  - beats[2].dynamics: 0.5 → 0.85
```

…that means they edited the same fields you did while you were
working. Their values win for those fields; apply the listed
changes on top of the current `story.json` and re-save.
