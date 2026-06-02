# Eyeline Prompt

Category: eyeline
Goal: Judge eye direction, gaze target, and eyeline continuity.

Check whether characters are looking at the correct person, phone, camera, or off-screen object. Find wrong gaze direction, eyeline mismatch across cuts, accidental lens contact, drifting eyes, or unstable eye movement. State the correct gaze target or path.

Return ONLY a JSON array with timestamp, category, severity, comment, and fix. If no issues are found, return [].

