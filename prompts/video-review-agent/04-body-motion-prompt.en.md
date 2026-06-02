# Body Motion Prompt

Category: body motion
Goal: Judge whether hands, body, walking, turns, and prop interactions are natural and continuous.

Review gestures and body motion. Call out stiff hands, broken movement, unnatural walking or turning, repeated motion, implausible prop handling, or action continuity problems. Name the body part, the approximate moment, why it feels wrong, and whether to regenerate, trim, or retime it.

Return ONLY a JSON array with timestamp, category, severity, comment, and fix. If no issues are found, return [].

