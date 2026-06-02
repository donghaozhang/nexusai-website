# Expression/Face Prompt

Category: expression/face
Goal: Judge whether facial emotion matches the story and whether facial details look natural.

Look for stiff, blank, exaggerated, mistimed, or emotionally wrong expressions. Be specific about eyes, mouth, eyebrows, blinking, smiles, and expression transitions. Explain which emotion should replace the current one and how the face should change.

Return ONLY a JSON array with timestamp, category, severity, comment, and fix. If no issues are found, return [].

