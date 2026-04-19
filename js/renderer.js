const Renderer = (() => {
    const LANDMARK_COLOR_OPEN = '#6366f1';
    const LANDMARK_COLOR_PINCH = '#f59e0b';
    const CONNECT_COLOR = 'rgba(99, 102, 241, 0.5)';

    let canvas = null;
    let ctx = null;
    let videoWidth = 320;
    let videoHeight = 240;

    function init(canvasElement) {
        canvas = canvasElement;
        ctx = canvas.getContext('2d');
    }

    function setSize(width, height) {
        videoWidth = width;
        videoHeight = height;
    }

    function clear() {
        if (!ctx) return;
        ctx.clearRect(0, 0, videoWidth, videoHeight);
    }

    function drawLandmarks(landmarks, isPinching) {
        if (!ctx || !landmarks) return;

        const color = isPinching ? LANDMARK_COLOR_PINCH : LANDMARK_COLOR_OPEN;

        // Draw connections
        drawConnections(landmarks);

        // Draw landmarks
        landmarks.forEach((landmark, index) => {
            const x = (1 - landmark.x) * videoWidth;
            const y = landmark.y * videoHeight;

            ctx.beginPath();
            ctx.arc(x, y, 5, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.fill();
        });
        
        ctx.shadowBlur = 0;
    }

    function drawConnections(landmarks) {
        if (!landmarks) return;

        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8], // Index
            [0, 9], [9, 10], [10, 11], [11, 12], // Middle
            [0, 13], [13, 14], [14, 15], [15, 16], // Ring
            [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
            [5, 9], [9, 13], [13, 17] // Palm
        ];

        ctx.strokeStyle = CONNECT_COLOR;
        ctx.lineWidth = 2;

        connections.forEach(([start, end]) => {
            const p1 = landmarks[start];
            const p2 = landmarks[end];

            ctx.beginPath();
            ctx.moveTo((1 - p1.x) * videoWidth, p1.y * videoHeight);
            ctx.lineTo((1 - p2.x) * videoWidth, p2.y * videoHeight);
            ctx.stroke();
        });
    }

    function updateLevelBar(volume) {
        const levelFill = document.getElementById('level-fill');
        if (levelFill) {
            levelFill.style.width = `${volume}%`;
        }
    }

    function updateVolumeDisplay(volume) {
        const volumeValue = document.getElementById('volume-value');
        if (volumeValue) {
            volumeValue.textContent = volume;
        }
    }

    // ── Flick arrow ───────────────────────────────────────────────────────────
    // direction: +1 = up arrow, -1 = down arrow, 0 = hidden
    // strength: 0–1, controls opacity + size
    let arrowOpacity = 0;      // current rendered opacity (fades out)
    let arrowDirection = 0;

    function drawFlickArrow(direction, strength) {
        if (!ctx || direction === 0) return;

        const cx = videoWidth / 2;
        const cy = videoHeight / 2;
        const size = 18 + strength * 10;      // 18–28px
        const opacity = Math.min(0.35, strength * 0.4);

        // Fade toward new direction immediately, fade out when still
        arrowDirection = direction;
        arrowOpacity = opacity;

        ctx.save();
        ctx.globalAlpha = arrowOpacity;
        ctx.translate(cx, cy);

        const color = direction === 1 ? '#6366f1' : '#f59e0b';

        // Chevron arrow pointing up (direction=+1) or down (direction=-1)
        ctx.beginPath();
        if (direction === 1) {
            // pointing up
            ctx.moveTo(0, -size);
            ctx.lineTo(size * 0.6, 0);
            ctx.lineTo(size * 0.25, 0);
            ctx.lineTo(size * 0.25, size * 0.55);
            ctx.lineTo(-size * 0.25, size * 0.55);
            ctx.lineTo(-size * 0.25, 0);
            ctx.lineTo(-size * 0.6, 0);
        } else {
            // pointing down
            ctx.moveTo(0, size);
            ctx.lineTo(size * 0.6, 0);
            ctx.lineTo(size * 0.25, 0);
            ctx.lineTo(size * 0.25, -size * 0.55);
            ctx.lineTo(-size * 0.25, -size * 0.55);
            ctx.lineTo(-size * 0.25, 0);
            ctx.lineTo(-size * 0.6, 0);
        }
        ctx.closePath();

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
        ctx.fill();

        ctx.restore();
        ctx.shadowBlur = 0;
    }

    function render(landmarks, volume, isPinching, rampDirection, rampStrength) {
        if (!landmarks) {
            clear();
            updateLevelBar(volume);
            updateVolumeDisplay(volume);
            return;
        }

        clear();
        drawLandmarks(landmarks, isPinching);
        if (rampDirection !== 0) {
            drawFlickArrow(rampDirection, rampStrength || 1);
        }
        updateLevelBar(volume);
        updateVolumeDisplay(volume);
    }

    return {
        init,
        setSize,
        render,
        clear,
        updateLevelBar,
        updateVolumeDisplay
    };
})();