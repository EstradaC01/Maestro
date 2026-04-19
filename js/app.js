const App = (() => {
    let isRunning = false;
    let currentVolume = 50;

    const elements = {};

    // Slider scale helpers
    // Flick threshold: slider 1–10 maps to 0.016–0.004 (higher slider = more sensitive = lower threshold)
    function sliderToFlickThreshold(v) { return 0.016 - (v - 1) * (0.012 / 9); }
    // Ramp rate: slider 1–10 maps to 0.4–3.0
    function sliderToRampRate(v) { return 0.4 + (v - 1) * (2.6 / 9); }

    function getElements() {
        elements.overlay       = document.getElementById('overlay');
        elements.startBtn      = document.getElementById('start-btn');
        elements.webcam        = document.getElementById('webcam');
        elements.webcamContainer = document.getElementById('webcam-container');
        elements.output        = document.getElementById('output');
        elements.youtubeUrl    = document.getElementById('youtube-url');
        elements.loadVideoBtn  = document.getElementById('load-video-btn');
        elements.volumeValue   = document.getElementById('volume-value');
        elements.levelFill     = document.getElementById('level-fill');
        elements.flickSlider   = document.getElementById('flick-slider');
        elements.rampSlider    = document.getElementById('ramp-slider');
        elements.flickValue    = document.getElementById('flick-value');
        elements.rampValue     = document.getElementById('ramp-value');
        elements.sensitivityReset = document.getElementById('sensitivity-reset');
        elements.logo          = document.getElementById('logo');
        elements.logoContainer = document.getElementById('logo-container');
        elements.videoContainer = document.getElementById('video-container');
    }

    function setupEventListeners() {
        elements.startBtn.addEventListener('click', startApp);

        elements.loadVideoBtn.addEventListener('click', () => {
            const url = elements.youtubeUrl.value.trim();
            if (url) YouTubePlayer.loadVideo(url);
        });

        elements.youtubeUrl.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const url = elements.youtubeUrl.value.trim();
                if (url) YouTubePlayer.loadVideo(url);
            }
        });

        elements.flickSlider.addEventListener('input', () => {
            const v = parseInt(elements.flickSlider.value);
            elements.flickValue.textContent = v;
            Gestures.setFlickThreshold(sliderToFlickThreshold(v));
        });

        elements.rampSlider.addEventListener('input', () => {
            const v = parseInt(elements.rampSlider.value);
            elements.rampValue.textContent = v;
            Gestures.setVolumeRampRate(sliderToRampRate(v));
        });

        elements.sensitivityReset.addEventListener('click', () => {
            elements.flickSlider.value = 5;
            elements.rampSlider.value  = 5;
            elements.flickValue.textContent = 5;
            elements.rampValue.textContent  = 5;
            Gestures.setFlickThreshold(sliderToFlickThreshold(5));
            Gestures.setVolumeRampRate(sliderToRampRate(5));
        });
    }

    async function startApp() {
        if (isRunning) return;

        isRunning = true;
        elements.overlay.classList.add('hidden');

        Renderer.init(elements.output);
        Renderer.setSize(320, 240);

        elements.webcam.style.opacity = '1';

        Gestures.init();

        Gestures.onVolumeChange((volume) => {
            currentVolume = volume;
            YouTubePlayer.setVolume(volume);
            Renderer.updateVolumeDisplay(volume);
            Renderer.updateLevelBar(volume);
        });

        Gestures.onPinchStart(() => {
            YouTubePlayer.pause();
        });

        Gestures.onPinchEnd(() => {
            YouTubePlayer.play();
        });

        await MediaPipeController.start(
            elements.webcam,
            elements.output,
            handleHandResults
        );

        console.log('Maestro started successfully');
    }

    function setStatusBadge(state) {
        const badge = document.getElementById('status-badge');
        const text  = document.getElementById('status-text');
        if (!badge || !text) return;
        badge.className = state;
        if (state === 'detecting')      text.textContent = 'Hand detected';
        else if (state === 'clenching')  text.textContent = 'Clenching!';
        else                            text.textContent = 'No hand detected';
    }

    function handleHandResults(landmarks, results) {
        if (!landmarks) {
            setStatusBadge('no-hand');
            Renderer.clear();
            Renderer.updateLevelBar(currentVolume);
            Renderer.updateVolumeDisplay(currentVolume);
            return;
        }

        const { volume, pinch } = Gestures.processHand(landmarks);
        const { direction, strength } = Gestures.getRampState();

        setStatusBadge(pinch ? 'clenching' : 'detecting');

        Renderer.render(landmarks, volume, pinch, direction, strength);
    }

    function init() {
        getElements();
        setupEventListeners();
        YouTubePlayer.init();
        updateLogoSize();
        window.addEventListener('resize', updateLogoSize);
    }

    function updateLogoSize() {
        if (!elements.logo || !elements.videoContainer) return;
        const videoHeight = elements.videoContainer.offsetHeight;
        elements.logo.style.height = (videoHeight * 0.12) + 'px';
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
