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
    const GESTURE_LOCKOUT   = 600;  // ms to suppress volume after fist/open event

    // Mutable so sensitivity sliders can update at runtime
    let flickThreshold = 0.008;     // min velocity (norm units/frame) to count as flick
    let volumeRampRate = 1.2;       // volume units per frame while flick is held

    // ── State ─────────────────────────────────────────────────────────────────
    let currentVolume      = 50;
    let isFist             = false;
    let fistDebounceEnd    = 0;
    let fistConfirmCount   = 0;
    let gestureCommandEnd  = 0;     // volume locked out until this timestamp

    let yHistory    = [];
    let velocity    = 0;
    let stillCount  = 0;
    let ramping     = false;
    let rampDirection = 0;

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
    // Cross product Z of two palm-plane vectors:
    //   v1 = index base (5) - wrist (0)
    //   v2 = pinky base (17) - wrist (0)
    //   crossZ = v1.x*v2.y - v1.y*v2.x
    //
    // crossZ > 0 → palm faces camera (front)
    // crossZ < 0 → backhand / palm facing away (back)
    //
    // Gesture rules:
    //   Front palm + up   → volume up    ✓
    //   Front palm + down → volume down  ✓
    //   Back hand  + down → volume down  ✓  (palm-push gesture)
    //   Back hand  + up   → suppressed   ✗  (wrist rotation artifact)
    function getPalmOrientation(landmarks) {
        const w  = landmarks[0];
        const v1 = { x: landmarks[5].x  - w.x, y: landmarks[5].y  - w.y };
        const v2 = { x: landmarks[17].x - w.x, y: landmarks[17].y - w.y };
        const crossZ = v1.x * v2.y - v1.y * v2.x;
        return crossZ > 0 ? 'front' : 'back';
    }

    // ── Velocity ──────────────────────────────────────────────────────────────
    function updateVelocity(wristY) {
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
            return { volume: currentVolume, pinch: isFist };
        }

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
        //
        // When active, palm orientation gates which directions are allowed:
        //   front palm → up and down both allowed
        //   back hand  → only downward movement allowed (palm-push to lower volume)
        //                upward movement while backhand is suppressed (rotation artifact)
        const orientation = getPalmOrientation(landmarks);

        if (isFist || now < gestureCommandEnd) {
            // Fully locked — flush everything
            yHistory = []; velocity = 0; ramping = false; rampDirection = 0;
        } else {
            updateVelocity(landmarks[0].y);
            const absVel = Math.abs(velocity);
            // Raw direction from velocity: negative = moving up in image = vol up (+1)
            const rawDir = velocity < 0 ? 1 : -1;

            // Suppress upward ramp when backhand is showing (rotation artifact guard)
            const directionAllowed = orientation === 'front' || rawDir === -1;

            if (absVel > flickThreshold && directionAllowed) {
                stillCount = 0;
                ramping = true;
                rampDirection = rawDir;
            } else if (absVel > flickThreshold && !directionAllowed) {
                // Moving up with backhand — flush to prevent ghost ramp
                yHistory = []; velocity = 0; ramping = false; rampDirection = 0;
                stillCount = 0;
            } else {
                stillCount++;
                if (stillCount >= STILLNESS_FRAMES) {
                    ramping = false;
                    rampDirection = 0;
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
        isPinching() { return isFist; },

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
