const MediaPipeController = (() => {
    let hands = null;
    let camera = null;
    let onResultsCallback = null;
    let isInitialized = false;

    async function initialize(videoElement, canvasElement, onResults) {
        onResultsCallback = onResults;

        console.log('MediaPipe: Initializing Hands...');

        hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
            }
        });

        hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 0,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        hands.onResults(onHandResults);

        console.log('MediaPipe: Starting camera...');

        camera = new Camera(videoElement, {
            onFrame: async () => {
                if (videoElement.readyState < 2) {
                    return;
                }
                if (hands) {
                    await hands.send({ image: videoElement });
                }
            },
            width: 320,
            height: 240
        });

        isInitialized = true;
        
        try {
            await camera.start();
            console.log('MediaPipe: Camera started successfully');
        } catch (err) {
            console.error('MediaPipe: Camera start failed:', err);
        }
    }

    async function onHandResults(results) {
        let landmarks = null;
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            landmarks = results.multiHandLandmarks[0];
            console.log('MediaPipe: Hand detected, landmarks count:', landmarks.length);
        } else {
            console.log('MediaPipe: No hand detected in frame');
        }

        if (onResultsCallback) {
            onResultsCallback(landmarks, results);
        }
    }

    return {
        isInitialized() {
            return isInitialized;
        },

        async start(videoElement, canvasElement, onResults) {
            return initialize(videoElement, canvasElement, onResults);
        },

        async stop() {
            if (camera) {
                camera.stop();
            }
            isInitialized = false;
        }
    };
})();