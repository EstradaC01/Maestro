const YouTubePlayer = (() => {
    let player = null;
    let isReady = false;
    const callbacks = [];

    function extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    function onReady(event) {
        isReady = true;
        player = event.target;
        callbacks.forEach(cb => cb(player));
    }

    function onStateChange(event) {
        // Can add event handling here if needed
    }

    return {
        init() {
            // Check if API already loaded
            if (window.YT && window.YT.Player) {
                // API already loaded, ready to create player
                return;
            }

            window.onYouTubeIframeAPIReady = () => {
                // Player will be created when loadVideo is called
            };
        },

        onReady(callback) {
            if (isReady && player) {
                callback(player);
            } else {
                callbacks.push(callback);
            }
        },

        loadVideo(url) {
            const videoId = extractVideoId(url);
            if (!videoId) {
                console.error('Invalid YouTube URL');
                return false;
            }

            const createPlayer = () => {
                if (!player) {
                    player = new YT.Player('player', {
                        height: '100%',
                        width: '100%',
                        videoId: videoId,
                        playerVars: {
                            'autoplay': 1,
                            'controls': 1,
                            'rel': 0,
                            'showinfo': 0,
                            'modestbranding': 1,
                            'playsinline': 1
                        },
                        events: {
                            'onReady': onReady,
                            'onStateChange': onStateChange
                        }
                    });
                } else {
                    player.loadVideoById(videoId);
                    isReady = true;
                }
            };

            // Check if YT is available
            if (window.YT && window.YT.Player) {
                createPlayer();
            } else {
                // Wait for API to load
                window.onYouTubeIframeAPIReady = createPlayer;
            }
            return true;
        },

        play() {
            if (player && isReady) {
                player.playVideo();
            }
        },

        pause() {
            if (player && isReady) {
                player.pauseVideo();
            }
        },

        togglePlay() {
            if (player && isReady) {
                const state = player.getPlayerState();
                if (state === YT.PlayerState.PLAYING) {
                    this.pause();
                } else {
                    this.play();
                }
            }
        },

        setVolume(volume) {
            if (player && isReady) {
                player.setVolume(Math.max(0, Math.min(100, volume)));
            }
        },

        getVolume() {
            if (player && isReady) {
                return player.getVolume();
            }
            return 50;
        },

        isPlaying() {
            if (player && isReady) {
                return player.getPlayerState() === YT.PlayerState.PLAYING;
            }
            return false;
        },

        isReady() {
            return isReady;
        }
    };
})();