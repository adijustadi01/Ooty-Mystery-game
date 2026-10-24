# Ooty Mysteries

A browser-based 3D detective game set in the Nilgiri hills, built with Three.js. Play it at
**https://adijustadi01.github.io/Ooty-Mystery-game/**

Walk through each location in first person, collect clues into your notebook, question suspects, rebuild
the timeline, then accuse the culprit (who + motive + key evidence). Solving a case unlocks the next one.
Progress is saved in the browser (`localStorage`).

- **Case 1: Death in the Monsoon.** A 1940s colonial bungalow in Ooty during the monsoon. 4 rooms, 5 suspects, 12 clues.
- **Case 2: The Coonoor Emeralds.** A short sample case at Coonoor railway station. It shows that the multi-case system works.

## Controls

| | Desktop | Phone / tablet |
|---|---|---|
| Move | `W A S D` / arrows (`Shift` to run) | Joystick (bottom-left) |
| Look | Click the scene to capture the mouse | Drag anywhere |
| Examine / talk | Aim the dot and click, or press `E` | Tap the object, or use the gold button |
| Notebook / Timeline | `N` / `T` | Buttons at the top |
| Pause | `Esc` | ☰ button |

## Running locally

The game is plain static files with no build step. Browsers block `fetch()` from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Three.js r160 is vendored in `lib/`, so the game doesn't need a CDN.

## Adding a new case (no code changes)

Drop a file named `cases/case03.json` (then `case04.json`, and so on) into `cases/`. The game finds case files
by number in order and stops at the first missing number. Each case unlocks when the previous one is solved.

Copy `cases/case02.json` as a starting template. The schema:

```jsonc
{
  "title": "Case title",
  "subtitle": "Place — date",
  "intro": ["Paragraph shown before the case starts", "..."],
  "briefing": { "victim": "...", "found": "...", "location": "...", "notes": "..." },
  "accuseQuestion": "Who killed the Colonel?",          // optional
  "setting": {
    "weather": "rain" | "mist" | "clear", "lightning": true,
    "skyColor": "#141c24", "fogColor": "#1a222b", "fogNear": 6, "fogFar": 34,
    "ambient": 0.6, "groundColor": "#1f2b1c"
  },
  "start": { "room": "drawing", "pos": [0, 2], "facing": 0 },   // facing in degrees, 0 = looking north (-z)

  "rooms": [{
    "id": "study", "name": "The Study",
    "center": [x, z], "size": [width, depth], "height": 3.2,     // world metres
    "floor": "#3e2716", "floorStyle": "wood" | "stone" | "plain",
    "wall": "#6b4f3a", "wainscot": "#2e1d10", "ceiling": "#2a1c12",
    "light": { "color": "#ffbf70", "intensity": 10 },
    "props": [{
      "type": "desk", "pos": [x, z], "y": 0, "size": [w, h, d], "rotY": 0, "color": "#3b2210",
      "name": "Desk", "examine": "Optional text shown when the player clicks it", "solid": true
    }]
  }],
  // Doors and windows in WORLD coordinates. Walls are cut wherever one sits on a room edge.
  "openings": [
    { "type": "door", "x": -4, "z": 0, "width": 1.6, "top": 2.3 },
    { "type": "window", "x": -8, "z": -4, "width": 2, "bottom": 0.9, "top": 2.4 }
  ],
  "clues": [{
    "id": "c_glass", "name": "Brandy Glass", "room": "study", "pos": [x, z], "y": 0.8,
    "shape": "paper|slate|book|glass|bottle|watch|bag|umbrella|lantern|necklace|box|…",
    "color": "#c98a3a", "description": "What the player reads", "pickup": true
  }],
  "suspects": [{
    "id": "hale", "name": "Dr. Edmund Hale", "role": "Family physician", "bio": "...",
    "room": "dining", "pos": [x, z], "facing": 120,
    "color": "#3a3a3a", "skin": "#e8c0a0", "hair": "#c0c0c0", "hat": "#4a5a2a",
    "greeting": "First line when you talk to them",
    "dialogue": [{
      "id": "d_hale_cut", "ask": "Where were you during the power cut?", "answer": "...",
      "statement": "Summary saved to the notebook",
      "requires": ["c_vial"]          // optional: only offered once these clue/statement ids are known
    }]
  }],
  "timeline": [
    { "time": "9:52 PM", "text": "...", "unlockedBy": ["c_watch", "d_mar_cut"] }   // omit unlockedBy = known from start
  ],
  "motives": [{ "id": "m_debt", "text": "..." }],
  "solution": {
    "culprit": "hale", "motive": "m_debt",
    "evidence": ["c_vial", "c_letter", "c_bag"],
    "explanation": ["Shown after the case is solved", "..."]
  }
}
```

Prop `pos` and clue/suspect `pos` are relative to the centre of their room. Furniture templates:
`box, cylinder, sphere, cone, rug, outline, table, desk, chair, bench, sofa, armchair, bookshelf, cabinet, clock,
lamp, door, painting, plant, fireplace, stove`. Templates face +z (south) at `rotY: 0`, and `size` is
`[width, height, depth]`.

### Scoring

Culprit 50, motive 20, key evidence up to 20 (−5 for each irrelevant item), thoroughness up to 10 (share of clues
found). The case counts as solved when the culprit and motive are right and at least one key piece of evidence
is presented.

## Deployment

GitHub Pages serves the `gh-pages` branch. `.github/workflows/pages.yml` mirrors `main` to `gh-pages` on every
push, so pushing to `main` updates the live site.
