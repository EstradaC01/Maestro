const Gestures = (() => {
    // ── Fist / open-palm (play/pause) ────────────────────────────────────────
    // Openness = mean distance of 4 fingertips from wrist / hand size.
    // Scale-invariant: works at any distance from the camera.
    const FIST_THRESHOLD    = 0.85;  // openness below → fist (pause)
    const OPEN_THRESHOLD    = 1.40;  // openness above → open palm (resume)
    const FIST_CONFIRM_FRAMES = 4;   // must hold fist N frames before firing
    const FIST_DEBOUNCE     = 150;   // ms — ignore jitter around transitions

    // ── Velocity / flick volume ───────────────────────────────────────────────
    const VELOCITY_WINDOW   = 6;    // frames to smooth velocity over
    const STILLNESS_FRAMES  = 8;    // still frames before ramp stops
    const GESTURE_LOCKOUT          = 600;  // ms to suppress volume after fist/open event
    const HAND_ENTRY_BUFFER        = 20;   // frames before volume ramp is allowed after hand appears
    const DIRECTION_CHANGE_MULT    = 2.5;  // new direction needs this × flickThreshold to override locked direction

    // Mutable so sensitivity sliders can update at runtime
    let flickThreshold = 0.008;     // min velocity (norm units/frame) to count as flick
    let volumeRampRate = 1.2;       // volume units per frame while flick is held

    // ── State ─────────────────────────────────────────────────────────────────
    let currentVolume      = 50;
    let isFist             = false;
    let fistDebounceEnd    = 0;
    let fistConfirmCount   = 0;
    let gestureCommandEnd  = 0;     // volume locked out until this timestamp
    let handEntryFrames    = 0;     // frames since hand was first detected

    let yHistory    = [];
    let velocity    = 0;
    let stillCount  = 0;
    let ramping     = false;
    let rampDirection = 0;
    let lastRampDirection  = 0;  // track previous direction for reversal detection
    let directionLocked    = 0;  // last confirmed ramp direction; 0 = unlocked

    let onFistStartCallback  = null;  // exposed as onPinchStart for app.js compat
    let onFistEndCallback    = null;  // exposed as onPinchEnd
    let onVolumeChangeCallback = null;

    // ── Helpers ───────────────────────────────────────────────────────────────
    function euclideanDistance(p1, p2) {
        return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    // ── Hand openness ─────────────────────────────────────────────────────────
    // Returns mean fingertip-to-wrist distance / hand size.
    // Fingertips: index=8, middle=12, ring=16, pinky=20. Wrist=0. HandRef=0→9.
    function getHandOpenness(landmarks) {
        const handSize = euclideanDistance(landmarks[0], landmarks[9]);
        if (handSize < 0.01) return 1; // degenerate frame — treat as neutral
        const tipIndices = [8, 12, 16, 20];
        const meanDist = tipIndices.reduce((sum, i) =>
            sum + euclideanDistance(landmarks[i], landmarks[0]), 0) / tipIndices.length;
        return meanDist / handSize;
    }

    // ── Palm orientation ──────────────────────────────────────────────────────
    // Simple, robust check: is the middle finger above or below the wrist?
    //
    // Landmarks:
    //   0 = wrist
    //   12 = middle finger tip
    //
    // If middle finger is higher (lower Y) than wrist → hand pointing up → front palm
    // If middle finger is lower (higher Y) than wrist → hand pointing down → backhand
    //
    // Gesture rules:
    //   Front palm + up   → volume up    ✓
    //   Front palm + down → volume down  ✓
    //   Back hand  + down → volume down  ✓  (palm-push gesture)
    //   Back hand  + up   → suppressed   ✗  (wrist rotation artifact)
    function getPalmOrientation(landmarks) {
        const wrist = landmarks[0];
        const middleFinger = landmarks[12];
        // If middle finger is higher up (smaller Y) than wrist → front palm
        return middleFinger.y < wrist.y ? 'front' : 'back';
    }

    // ── Velocity ──────────────────────────────────────────────────────────────
    // Max plausible per-frame wrist movement for a real gesture (~10% of frame height).
    // Anything larger is a position discontinuity (hand left and re-entered), not motion.
    const TELEPORT_THRESHOLD = 0.10;

    function updateVelocity(wristY) {
        // If the wrist jumped impossibly far since the last sample, the hand
        // re-entered from a different position — flush history so those samples
        // don't poison the velocity calculation.
        if (yHistory.length > 0) {
            const lastY = yHistory[yHistory.length - 1];
            if (Math.abs(wristY - lastY) > TELEPORT_THRESHOLD) {
                yHistory = [];
                velocity = 0;
            }
        }

        yHistory.push(wristY);
        if (yHistory.length > VELOCITY_WINDOW) yHistory.shift();
        if (yHistory.length < 2) { velocity = 0; return; }
        let total = 0;
        for (let i = 1; i < yHistory.length; i++) total += yHistory[i] - yHistory[i - 1];
        velocity = total / (yHistory.length - 1);
    }

    // ── Main process ──────────────────────────────────────────────────────────
    function processHand(landmarks) {
        if (!landmarks || landmarks.length < 21) {
            handEntryFrames = 0;
            lastRampDirection = 0;
            directionLocked = 0;
            return { volume: currentVolume, pinch: isFist };
        }

        // Increment hand entry counter each frame a hand is detected
        handEntryFrames++;

        const now = Date.now();

        // ── 1. Fist / open-palm state machine ─────────────────────────────────
        const openness = getHandOpenness(landmarks);
        const debounceReady = now > fistDebounceEnd;

        if (!isFist) {
            if (openness < FIST_THRESHOLD) {
                fistConfirmCount++;
                if (fistConfirmCount >= FIST_CONFIRM_FRAMES && debounceReady) {
                    isFist = true;
                    fistDebounceEnd   = now + FIST_DEBOUNCE;
                    gestureCommandEnd = now + GESTURE_LOCKOUT;
                    yHistory = []; velocity = 0; ramping = false;
                    console.log('Gestures: FIST START (openness:', openness.toFixed(3), ')');
                    if (onFistStartCallback) onFistStartCallback();
                }
            } else {
                fistConfirmCount = 0;
            }
        } else {
            if (openness > OPEN_THRESHOLD && debounceReady) {
                isFist = false;
                fistConfirmCount  = 0;
                fistDebounceEnd   = now + FIST_DEBOUNCE;
                gestureCommandEnd = now + GESTURE_LOCKOUT;
                yHistory = []; velocity = 0; ramping = false;
                console.log('Gestures: FIST END / PALM OPEN (openness:', openness.toFixed(3), ')');
                if (onFistEndCallback) onFistEndCallback();
            }
        }

        // ── 2. Velocity-based volume ──────────────────────────────────────────
        // Suppressed entirely while fist is held or during the post-gesture lockout.
        // Also suppressed during the hand entry buffer period to avoid jitter.
        //
        // When active, palm orientation gates which directions are allowed:
        //   front palm → up and down both allowed
        //   back hand  → only downward movement allowed (palm-push to lower volume)
        //                upward movement while backhand is suppressed (rotation artifact)
        const orientation = getPalmOrientation(landmarks);
        const handStable = handEntryFrames > HAND_ENTRY_BUFFER;

        if (isFist || now < gestureCommandEnd) {
            // Fully locked by fist or post-gesture lockout — flush everything
            yHistory = []; velocity = 0; ramping = false; rampDirection = 0;
        } else {
            // Always collect Y samples so the velocity window is warm when the
            // buffer expires — but only act on them once handStable is true.
            updateVelocity(landmarks[0].y);
            const absVel = Math.abs(velocity);
            const rawDir = velocity < 0 ? 1 : -1;

            if (!handStable) {
                // Buffer period: accumulate Y history but suppress all ramping
                ramping = false;
                rampDirection = 0;
                stillCount = 0;
                lastRampDirection = 0;
            } else {
                lastRampDirection = rawDir;

                // Suppress upward ramp when backhand is showing
                const directionAllowed = orientation === 'front' || rawDir === -1;

                if (absVel > flickThreshold && directionAllowed) {
                    // Direction change after a confirmed ramp requires a stronger
                    // intentional flick — prevents natural return movement triggering
                    // the opposite direction immediately after a gesture.
                    const changingDirection = directionLocked !== 0 && rawDir !== directionLocked;
                    const intentThreshold  = changingDirection
                        ? flickThreshold * DIRECTION_CHANGE_MULT
                        : flickThreshold;

                    if (absVel >= intentThreshold) {
                        stillCount = 0;
                        ramping = true;
                        rampDirection = rawDir;
                        directionLocked = rawDir;
                    }
                } else if (absVel > flickThreshold && !directionAllowed) {
                    // Moving up with backhand — flush to prevent ghost ramp
                    yHistory = []; velocity = 0; ramping = false; rampDirection = 0;
                    stillCount = 0;
                } else {
                    stillCount++;
                    if (stillCount >= STILLNESS_FRAMES) {
                        ramping = false;
                        rampDirection = 0;
                        directionLocked = 0;  // hand is still — unlock direction
                    }
                }

                if (ramping) {
                    const speed = clamp(absVel / flickThreshold, 1, 3);
                    currentVolume = clamp(
                        currentVolume + rampDirection * volumeRampRate * speed,
                        0, 100
                    );
                    if (onVolumeChangeCallback) onVolumeChangeCallback(Math.round(currentVolume));
                }
            }
        }

        return { volume: Math.round(currentVolume), pinch: isFist };
    }

    // ── Public API ────────────────────────────────────────────────────────────
    return {
        init() {
            currentVolume     = 50;
            isFist            = false;
            fistDebounceEnd   = 0;
            fistConfirmCount  = 0;
            gestureCommandEnd = 0;
            handEntryFrames   = 0;
            lastRampDirection = 0;
            directionLocked   = 0;
            yHistory          = [];
            velocity          = 0;
            stillCount        = 0;
            ramping           = false;
            rampDirection     = 0;
        },

        processHand,

        // app.js uses these names — kept for compatibility
        onPinchStart(cb) { onFistStartCallback = cb; },
        onPinchEnd(cb)   { onFistEndCallback   = cb; },
        onPinch(cb)      { onFistStartCallback = cb; },

        onVolumeChange(cb) { onVolumeChangeCallback = cb; },

        getVolume()  { return Math.round(currentVolume); },
        isclenching() { return isFist; },

        getRampState() {
            const absVel   = Math.abs(velocity);
            const strength = ramping ? clamp(absVel / flickThreshold, 0.3, 1) : 0;
            return { direction: rampDirection, strength };
        },

        setFlickThreshold(val) { flickThreshold = val; },
        setVolumeRampRate(val) { volumeRampRate  = val; },
        getFlickThreshold()    { return flickThreshold; },
        getVolumeRampRate()    { return volumeRampRate; },
    };
})();
