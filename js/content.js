// TC object stub
var TC = {state: 'notInitialized'};

// listen to instructions from background page
if (window === window.top) {
    chrome.runtime.onMessage.addListener(function (message, sender, callback) {
        if (message.type === "browserAction") {
            switch (TC.state) {
                case 'notInitialized':
                    initializeTabCinema();
                // note the fall-through here
                case 'normal':
                    TC.findVideos([]);
                    break;
                case 'maximized':
                    TC.minimizeVideo();
                    break;
                case 'overlay':
                    TC.removeOverlays();
                    break;
            }
        }
    });
}

// listen to events from child/parent windows
var TCrequests = [
    'requestVideos',
    'reportVideos',
    'reportDone',
    'maximizeVideo',
    'minimizeVideo',
    'addOverlay',
    'removeOverlays',
    'removeOverlay',
    'requestEndFullscreen'
];

window.addEventListener("message", function (event) {
    if (TCrequests.indexOf(event.data.message) === -1) {
        // do not respond to messages that do not belong to TC
        return;
    }

    // initialize TabCinema upon first message
    if (TC.state === "notInitialized") {
        initializeTabCinema();
    }

    // process message
    switch (event.data.message) {
        case 'requestVideos':
            TC.findVideos(event.data.path);
            break;
        case 'reportDone':
            TC.processReport();
            break;
        case 'reportVideos':
            TC.addVideos(event.source, event.data.videos);
            break;
        case 'maximizeVideo':
            TC.maximizeVideo(event.data.path);
            break;
        case 'minimizeVideo':
            TC.minimizeVideo();
            break;
        case 'addOverlay':
            TC.addOverlay(event.data.uid);
            break;
        case 'removeOverlays':
            TC.removeOverlays();
            break;
        case 'removeOverlay':
            TC.removeOverlay(event.data.uid);
            break;
        case 'requestEndFullscreen':
            TC.minimizeVideo();
            break;
    }
}, false);

// listen to shortcut key
document.body.addEventListener('keydown', function (e) {
    if ((e.keyCode === 32 && e.ctrlKey) || (e.keyCode === 27 && (TC.state === 'maximized' || TC.state === 'overlay'))) {
        switch (TC.state) {
            default:
            case 'notInitialized':
            case 'normal':
                window.top.postMessage({
                    message: 'requestVideos',
                    path: []
                }, '*');
                break;
            case 'maximized':
                window.top.postMessage({
                    message: 'requestEndFullscreen'
                }, '*');
                break;
            case 'overlay':
                window.top.postMessage({
                    message: 'removeOverlays'
                }, '*');
                break;
        }
        e.stopPropagation();
        e.preventDefault();
    }
});

// populate TC object
function initializeTabCinema() {
    TC = {

        // options
        options: {
            scanTags: [
                "video",
                "embed",
                "object",
                "img",
                "canvas"
            ],
            scanTimeout: 250,
            minSize: 150
        },

        // local variables
        state: "normal",
        path: [],
        allVideos: [],
        myVideos: {},
        iframes: {},
        target: {},
        scrollBeforeMaximize: {top: 0, left: 0},
        handleVideoRemoveTimeout: 0,
        wrapUpTimeout: 0,
        pendingReports: 0,
        inlineStyleSubtle: "\
		clear		: none		!important;\
		top			: 0			!important;\
		left		: 0 		!important;\
		min-width	: 0			!important;\
		min-height	: 0			!important;\
		width		: 99.99%		!important;\
		height		: 99.99%		!important;\
		max-width	: 99.99%		!important;\
		max-height	: 99.99%		!important;\
		margin		: 0			!important;\
		padding		: 0			!important;\
		visibility	: visible	!important;\
		border-width: 0			!important;\
		background	: black		!important;",
        inlineStyleForce: "\
		position	: fixed 	!important;\
		top			: 0			!important;\
		left		: 0 		!important;\
		min-width	: 0			!important;\
		min-height	: 0			!important;\
		width		: 99.99%		!important;\
		height		: 99.99%		!important;\
		max-width	: 99.99%		!important;\
		max-height	: 99.99%		!important;\
		margin		: 0			!important;\
		padding		: 0			!important;\
		visibility	: visible	!important;\
		border-width: 0			!important;\
		background	: black		!important;",

        // find all videos on this page
        findVideos: function (path) {

            // store path for later reference
            this.path = path;

            // reset collections
            this.allVideos = [];
            this.myVideos = {};
            this.iframes = {};

            // first find all video elements in this frame and report
            var videos = [];
            var elmts = document.querySelectorAll(this.options.scanTags.join(','));
            for (var i = 0; i < elmts.length; i++) {

                var el = elmts[i];

                // skip tiny elements
                if (Math.min(el.offsetWidth, el.offsetHeight) < this.options.minSize) {
                    continue;
                }

                // skip objects that are invisible or not currently in the viewport
                if (this.fractionInViewport(el) === 0) {
                    continue;
                }

                // be careful with objects containing embeds (common flash construction)
                var tag = el.nodeName.toLowerCase();
                if (tag === 'embed') {
                    if (el.parentNode.nodeName.toLowerCase() === 'object') {
                        if (Math.min(el.parentNode.offsetWidth, el.parentNode.offsetHeight) > this.options.minSize) {
                            // parent object will be scanned in due time; skip this embed
                            continue;
                        }
                    }
                }
                else if (tag === 'object') {
                    var embeds = el.getElementsByTagName('embed');
                    if (embeds.length !== 0) {
                        // always scale the embed rather than the object
                        el = embeds[0];
                    }
                }

                // generate (semi) unique path
                var uid = '' + Math.round(Math.random() * 1e9);

                // add to videos collection to forward to main page
                videos.push({
                    uid: uid,
                    path: this.path.concat([uid]),
                    tag: tag
                });

                // add to private video collection
                this.myVideos[uid] = el;

            }

            // send videos collection to wrap-up function
            if (videos.length > 0) {
                if (window === window.top) {
                    this.addVideos(window, videos);
                }
                else {
                    // report results to top window
                    window.top.postMessage({
                        message: 'reportVideos',
                        videos: videos
                    }, '*');
                }
            }

            // then tell all iframes to report their videos
            var iframes = document.querySelectorAll("iframe");
            this.pendingReports = 0;
            for (var i = 0; i < iframes.length; i++) {
                var frame = iframes[i];
                // only scan iframes that are currently in the content window
                if (this.fractionInViewport(frame) > 0) {
                    var uid = '' + Math.round(Math.random() * 1e9);
                    this.iframes[uid] = frame;
                    this.pendingReports++;
                    frame.contentWindow.postMessage({
                        message: 'requestVideos',
                        path: this.path.concat([uid])
                    }, '*');
                }
            }

            // wrap up reports if there are no iframes, or set a timeout
            if (this.pendingReports === 0) {
                this.wrapUpReports();
            }
            else {
                this.wrapUpTimeout = window.setTimeout(function () {
                    console.warn('TC iframe timeout');
                    TC.wrapUpReports();
                }, this.options.scanTimeout);
            }
        },

        // top window: handle reports of videos in iframes
        addVideos: function (parentWindow, videos) {
            for (var i in videos) {
                videos[i].window = parentWindow;
            }
            this.allVideos = this.allVideos.concat(videos);
        },

        // iframe reporting in
        processReport: function () {
            if (--this.pendingReports === 0) {
                window.clearTimeout(this.wrapUpTimeout);
                this.wrapUpReports();
            }
        },

        // after all reports have come in, or timeout occured, take action
        wrapUpReports: function () {

            if (window !== window.top) {
                // signal parent that we're finished here
                window.parent.postMessage({
                    message: 'reportDone'
                }, '*');
            }
            else {

                // all reports are in... find out which video to maximize
                if (this.allVideos.length === 1) {

                    // only one candidate -> maximize that one
                    this.maximizeVideo(this.allVideos[0].path);

                }
                else if (this.allVideos.length > 1) {

                    // multiple candidates -> videos take precedence
                    var videoCount = 0, videoIndex = 0;
                    for (var i = 0; i < this.allVideos.length; i++) {
                        if (this.allVideos[i].tag !== 'img') {
                            videoCount++;
                            videoIndex = i;
                        }
                    }

                    if (videoCount === 1) {

                        // only one video -> maximize that
                        this.maximizeVideo(this.allVideos[videoIndex].path);

                    }
                    else {

                        // multiple or zero video elements -> let user choose via overlays
                        this.addOverlays();

                    }
                }
                else {

                    // no videos or images found
                    if (this.stage === "maximized") {
                        window.top.postMessage({
                            message: 'requestEndFullscreen'
                        }, '*');
                    }

                }

            }

        },

        // start the maximizing process for a single video
        maximizeVideo: function (path) {

            // state-dependent first action
            if (this.state === "maximized") {

                // was maximized already, clean up remnants of current video
                if (this.target.tag === "video" && !this.target.isYTHTML5) {
                    this.target.customControls.destroy();
                }

            }
            else {

                // new maximize, remember scroll position
                this.scrollBeforeMaximize = {
                    top: document.body.scrollTop,
                    left: document.body.scrollLeft
                };

                // remove overlays if any
                if (this.state === "overlay") {
                    this.removeOverlays();
                }
            }

            // take action depending on iframe or element
            if (path.length > 1) {

                // set frame CSS
                this.target = {
                    DOMnode: this.iframes[path[0]],
                    tag: 'iframe',
                    subtle: false
                };
                this.maximizeTarget();

                // communicate down
                this.iframes[path[0]].contentWindow.postMessage({
                    message: 'maximizeVideo',
                    path: path.slice(1)
                }, '*');

            }
            else {

                // collect target from myVideos collection
                var el = this.myVideos[path[0]];

                // set target properties
                this.target = {
                    DOMnode: el,
                    tag: el.nodeName.toLowerCase(),
                    player: this.getPlayer(el),
                    quality: this.getQuality(el),
                    subtle: true
                };

                // replace scaling variable
                if (this.target.tag === 'object') {
                    var params = this.target.DOMnode.getElementsByTagName('param');
                    for (var i = 0; i < params.length; i++) {
                        if (params[i].name === 'scale') {
                            if (params[i].value === 'noscale') {
                                this.target.subtle = false;
                                this.target.scaleParam = params[i].value;
                                params[i].value = 'default';
                            }
                        }
                        else if (params[i].name === 'flashvars') {
                            var fv = params[i].value;
                            if (fv) {
                                var newfv = fv.replace(/stretching=[^&]*/i, 'stretching=uniform');
                                if (newfv !== fv) {
                                    this.target.subtle = false;
                                    this.target.fv = fv;
                                    params[i].value = newfv;
                                }
                            }
                        }
                    }
                }
                else if (this.target.tag === 'embed') {
                    var fv = this.target.DOMnode.getAttribute('flashvars');
                    if (fv) {
                        this.target.fv = fv;
                        var newfv = fv.replace(/stretching=[^&]*/i, 'stretching=uniform');
                        this.target.DOMnode.setAttribute('flashvars', newfv);
                    }
                }

                // change quality
                this.setQuality(this.target.DOMnode, 'highest');

                // add custom controls to HTML5 video
                if (this.target.tag === 'video') {

                    // do not replace yt html5 controls as this messes up the buffering
                    if (window.location.host === "www.youtube.com") {
                        var controls = document.querySelector('.html5-video-controls');
                        if (controls) {
                            this.target.isYTHTML5 = true;
                            this.target.YTHTML5controls = controls;
                            this.target.controlsVisible = false;
                            if (typeof controls['originalStyle'] === "undefined") {
                                controls['originalStyle'] = controls.getAttribute('style') || '';
                                controls.setAttribute('style', controls['originalStyle'] + 'position: absolute !important; visibility: hidden !important;');
                                TC.addClassDeep(controls, 'tc-show');
                            }
                            var hideControlsTimeout = 0;
                            var onControls = false;
                            document.body.addEventListener('mousemove', this.handleYTHTML5MouseMove);
                        }
                    }

                    // hide standard controls and add custom HTML5 controls to circumvent click handler issues
                    if (!this.target.isYTHTML5) {
                        this.target.subtle = true;
                        this.target.controls = this.target.DOMnode.controls;
                        this.target.DOMnode.controls = false;
                        this.target.customControls = this.createHTML5Controls(this.target.DOMnode);
                        this.target.DOMnode.parentNode.appendChild(this.target.customControls.container);
                    }
                }

                // add css to element
                this.maximizeTarget();

                // set focus to video
                try {
                    this.target.DOMnode.focus();
                } catch (err) {
                }

            }

            // scroll to top left
            document.body.scrollTop = document.body.scrollLeft = 0;

            // take actions that are not to be repeated when maximizing next video in playlist
            if (this.state !== "maximized") {

                // create an observer instance to register changes in the document while maximized
                this.removedObserver = new MutationObserver(this.handleMutations);
                this.removedObserver.observe(document.body, {childList: true, subtree: true});

                // set new state
                this.state = "maximized";

            }

        },

        // Maximize action DOM manipulations
        maximizeTarget: function () {

            var el = this.target.DOMnode;

            // for images, simply set the image as the body background
            if (this.target.tag === 'img') {
                var src = el.src || '';
                el = document.body;
                while (el !== document) {

                    // make sure element remains visible
                    el.classList.add('tc-show');

                    // maximize all parents if in subtle mode
                    if (typeof el['originalStyle'] === "undefined") {
                        el['originalStyle'] = el.getAttribute('style') || '';
                    }

                    // append style rather than replacing it, in case element has inline properties that might trigger reload when removed (e.g. position)
                    if (el === document.body) {
                        el.setAttribute('style', el['originalStyle'] + this.inlineStyleSubtle + 'background: black url("' + src + '") no-repeat center center fixed !important;  background-size: contain !important;');
                    }
                    else {
                        el.setAttribute("style", el['originalStyle'] + this.inlineStyleSubtle);
                    }

                    // move up one level
                    el = el.parentNode;
                }
                return;
            }

            // be more subtle with embeds and objects to avoid triggering reloads
            if (!this.target.subtle) {
                if (typeof el['originalStyle'] === "undefined") {
                    el['originalStyle'] = el.getAttribute('style') || '';
                }
                el.setAttribute("style", this.inlineStyleForce);
            }

            while (el !== document) {

                // make sure element remains visible
                el.classList.add('tc-show');

                // maximize all parents without being subtle
                el.classList.add('tc-subtle');
                if (typeof el['originalStyle'] === "undefined") {
                    el['originalStyle'] = el.getAttribute('style') || '';
                }
                // append style rather than replacing it, in case element has inline properties that might trigger reload when removed (e.g. position)
                el.setAttribute("style", el['originalStyle'] + this.inlineStyleSubtle);

                // move up one level
                el = el.parentNode;

            }
        },

        // Minimize the active video
        minimizeVideo: function () {

            // restore state
            this.state = "normal";

            // stop observing DOM changes
            this.removedObserver.disconnect();

            // restore object parameters
            if (typeof this.target.scale !== "undefined") {
                this.target.DOMnode.scale = this.target.scale;
            }

            // tag-specific restorations
            if (this.target.tag === "iframe") {
                this.target.DOMnode.contentWindow.postMessage({message: 'minimizeVideo'}, '*');
            }
            else if (this.target.tag === "video") {
                if (this.target.isYTHTML5) {
                    window.clearTimeout(TC.hideControlsTimeout);
                    document.body.removeEventListener('mousemove', this.handleYTHTML5MouseMove);
                    var controls = this.target.YTHTML5controls;
                    controls.setAttribute('style', controls['originalStyle']);
                    TC.removeClassDeep(controls, 'tc-show');
                }
                else {
                    this.target.customControls.destroy();
                    this.target.DOMnode.controls = this.target.controls;
                }
            }
            else if (this.target.tag === 'embed') {
                if (this.target.fv) {
                    this.target.DOMnode.setAttribute('flashvars', this.target.fv);
                }
            }
            else if (this.target.tag === 'object') {
                if (this.target.scaleParam || this.target.fv) {
                    var params = this.target.DOMnode.getElementsByTagName('param');
                    for (var i = 0; i < params.length; i++) {
                        if (this.target.scaleParam && params[i].name === 'scale') {
                            params[i].value = this.target.scaleParam;
                        }
                        else if (this.target.fv && params[i].name === 'flashvars') {
                            params[i].value = this.target.fv;
                        }
                    }
                }
            }

            // restore elements
            this.minimizeTarget();

            //restore scroll position
            document.body.scrollTop = this.scrollBeforeMaximize.top
            document.body.scrollLeft = this.scrollBeforeMaximize.left;

            // reset collections
            this.allVideos = [];
            this.myVideos = {};
            this.iframes = {};
        },

        // Minimize video DOM actions
        minimizeTarget: function () {

            if (!this.target.DOMnode) {
                // this can occur if the video was removed
                return;
            }

            // for images, simply set the image as the body background
            if (this.target.tag === 'img') {
                el = document.body;
                while (el !== document) {

                    // make sure element remains visible
                    el.classList.remove('tc-show');

                    el.setAttribute('style', el['originalStyle']);
                    el.removeAttribute('originalStyle');

                    // move up one level
                    el = el.parentNode;
                }
                return;
            }

            // restore target css
            var el = this.target.DOMnode;
            if (!this.target.subtle) {
                el.setAttribute('style', el['originalStyle']);
                el.removeAttribute('originalStyle');
            }

            while (el && el !== document) {

                // remove added class
                el.classList.remove('tc-show');

                // restore css
                el.classList.remove('tc-subtle');
                el.setAttribute('style', el['originalStyle']);
                el.removeAttribute('originalStyle');

                // move up one level
                el = el.parentNode;
            }
        },

        // show a button on top of each video
        addOverlays: function () {
            this.state = 'overlay';
            for (var i = 0; i < this.allVideos.length; i++) {
                var video = this.allVideos[i];
                if (video.window === window) {
                    this.addOverlay(video.uid);
                }
                else {
                    video.window.postMessage({
                        message: 'addOverlay',
                        uid: video.uid
                    }, '*');
                }
            }
        },

        // remove overlays over videos
        removeOverlays: function () {
            this.state = 'normal';
            for (var i = 0; i < this.allVideos.length; i++) {
                var video = this.allVideos[i];
                if (video.window === window) {
                    this.removeOverlay(video.uid);
                }
                else {
                    video.window.postMessage({
                        message: 'removeOverlay',
                        uid: video.uid
                    }, '*');
                }
            }
        },

        // create and insert overlay button
        addOverlay: function (uid) {
            var el = this.myVideos[uid];
            var div = document.createElement('div');
            div.classList.add('tc-overlay');
            div.style.width = el.offsetWidth + 'px';
            div.style.height = el.offsetHeight + 'px';
            div.style.lineHeight = el.offsetHeight + 'px';
            div.innerHTML = 'Click to maximize';
            div.setAttribute('videoUid', uid);
            div.addEventListener('click', this.handleOverlayClick);
            if (el.nextSibling) {
                el.parentNode.insertBefore(div, el.nextSibling);
            }
            else {
                el.parentNode.appendChild(div);
            }
            var elRect = el.getBoundingClientRect();
            var divRect = div.getBoundingClientRect();
            var topError = elRect.top - divRect.top;
            var leftError = elRect.left - divRect.left;
            div.style.marginLeft = leftError + 'px';
            div.style.marginTop = topError + 'px';
        },

        // remove overlay button
        removeOverlay: function (uid) {
            var overlays = document.querySelectorAll('.tc-overlay');
            for (var i = 0; i < overlays.length; i++) {
                if (uid === overlays[i].getAttribute('videoUid')) {
                    overlays[i].removeEventListener('click', this.handleOverlayClick);
                    overlays[i].parentNode.removeChild(overlays[i]);
                }
            }
        },

        // handle click on overlay
        handleOverlayClick: function (e) {
            var uid = e.target.getAttribute('videoUid');
            window.top.postMessage({
                message: 'maximizeVideo',
                path: TC.path.concat([uid])
            }, '*');
            e.preventDefault();
            e.stopPropagation();
        },

        // handle changes in the document (such as occur in playlists when the video is replaced)
        handleMutations: function (mutations) {
            if (!TC.hasClass(document.body, "tc-show")) {
                window.clearTimeout(TC.handleVideoRemoveTimeout);
                TC.handleVideoRemoveTimeout = window.setTimeout(function () {
                    TC.handleVideoRemoved()
                }, 100);
            }
            else {
                mutations.forEach(function (mutation) {
                    for (var i in mutation.removedNodes) {
                        if (TC.hasClass(mutation.removedNodes[i], 'tc-show')) {
                            window.clearTimeout(TC.handleVideoRemoveTimeout);
                            TC.handleVideoRemoveTimeout = window.setTimeout(function () {
                                TC.handleVideoRemoved()
                            }, 100);
                        }
                    }
                });
            }
        },

        // action to take when the video was removed from the DOM
        handleVideoRemoved: function () {

            // find next video to maximize if current one is removed
            this.findVideos([]);
        },

        // show youtube html5 controls upons mousemove
        handleYTHTML5MouseMove: function (e) {
            var onControls = e.clientY > window.innerHeight - 40;
            var controls = TC.target.YTHTML5controls;
            if (TC.target.controlsVisible) {
                window.clearTimeout(TC.hideControlsTimeout);
            }
            else {
                controls.setAttribute('style', controls['originalStyle'] + 'position: fixed !important; visibility: visible !important;');
                TC.target.controlsVisible = true;
            }
            TC.hideControlsTimeout = window.setTimeout(function () {
                if (!onControls) {
                    controls.setAttribute('style', controls['originalStyle'] + 'position: absolute !important; visibility: hidden !important;');
                    TC.target.controlsVisible = false;
                }
            }, 1000);
        },

        // jQuery hasClass function
        hasClass: function (node, selector) {
            var className = " " + selector + " ";
            if (node.nodeType === 1 && (" " + node.className + " ").replace(/[\t\r\n\f]/g, " ").indexOf(className) >= 0) {
                return true;
            }
            else {
                return false;
            }
        },

        // add class to element and all children (recursively)
        addClassDeep: function (el, cls) {
            if (el.classList) {
                el.classList.add(cls);
            }
            var children = el.childNodes;
            for (var i in children) {
                TC.addClassDeep(children[i], cls);
            }
        },

        // remove class from element and all children (recursively)
        removeClassDeep: function (el, cls) {
            if (el.classList) {
                el.classList.remove(cls);
            }
            var children = el.childNodes;
            for (var i in children) {
                TC.removeClassDeep(children[i], cls);
            }
        },

        // determine if element is currently visible
        isVisible: function (el) {
            return (el.clientWidth > 0 || el.clientHeight > 0) && window.getComputedStyle(el).visibility !== 'hidden';
        },

        getOffset: function (el) {
            var offset = {left: 0, top: 0};
            do {
                offset.left += (el.offsetLeft || 0);
                offset.top += (el.offsetTop || 0);
            } while (el = el.offsetParent);
            return offset;
        },

        fractionInViewport: function (el) {
            var rect = el.getBoundingClientRect();
            var visibleRect = {
                top: Math.max(0, rect.top),
                right: Math.min(window.innerWidth || document.documentElement.clientWidth, rect.right),
                bottom: Math.min(window.innerHeight || document.documentElement.clientHeight, rect.bottom),
                left: Math.max(0, rect.left)
            };
            visibleRect.width = Math.max(0, visibleRect.right - visibleRect.left);
            visibleRect.height = Math.max(0, visibleRect.bottom - visibleRect.top);

            return (visibleRect.width * visibleRect.height) / (rect.width * rect.height);
        },

        getPlayer: function (el) {
            if (el.nodeName.toLowerCase() === 'video') {
                return "html5";
            }
            else if (el.getPlayerState) {
                return "yt";
            }
            else if (el.getConfig) {
                return "jw4";
            }
            else {
                return "other";
            }
        },

        getQuality: function (el) {
            var player = this.getPlayer(el);
            if (player === "yt") {
                try {
                    return el.getPlaybackQuality();
                } catch (err) {
                }
            }
            else {
                return "";
            }
        },

        setQuality: function (el, q) {
            var player = this.getPlayer(el);
            if (player === "yt") {
                try {
                    if (q === 'highest') {
                        var qs = el.getAvailableQualityLevels();
                        q = qs[0];
                    }
                    window.setTimeout(function () {
                        try {
                            el.setPlaybackQuality(q);
                        } catch (err) {
                        }
                    }, 200);
                } catch (e) {
                }
            }
        },

        createHTML5Controls: function (node) {
            var html5controls = {

                video: node,
                container: null,

                construct: function () {

                    // create container
                    this.container = document.createElement('div');
                    this.container.classList.add('tc-show');
                    this.container.setAttribute('id', 'tc-html5-controls-hover-container');
                    this.container.setAttribute('style', 'display: block; text-align: center; width: 99.99%; height: 50px; position: fixed; bottom: 0; left: 0; z-index: 10000');

                    // create inner container
                    this.inner = document.createElement('div');
                    this.inner.classList.add('tc-show');
                    this.inner.setAttribute('style', 'position: relative; width: 50%; padding: 0px 30px; margin: 5px auto; height: 30px; background-color: rgba(0,0,0,0.5); border-radius: 5px; box-shadow: 0px 0px 10px #888;  -webkit-box-sizing: content-box;-moz-box-sizing: content-box;box-sizing: content-box;');
                    this.container.appendChild(this.inner);

                    // create stretching container
                    var stretch = document.createElement('div');
                    stretch.classList.add('tc-show');
                    stretch.setAttribute('style', 'position: relative; width: 99.99%;');
                    this.inner.appendChild(stretch);

                    // add play/pause button
                    this.btnPlay = document.createElement('div');
                    this.btnPlay.setAttribute('style', 'position: absolute; left: 5px; top: 5px; width: 20px; height: 20px; background-color: rgba(100,100,100,0.5); color: #fff; font-size: 16px; line-height: 20px; border-radius: 3px; cursor: pointer');
                    this.btnPlay.classList.add('tc-show');
                    this.updateState();
                    this.inner.appendChild(this.btnPlay);

                    // add progress bar
                    this.progressBar = document.createElement('div');
                    this.progressBar.classList.add('tc-show');
                    this.progressBar.setAttribute('style', 'float: left; position: relative; margin: 5px 0; height: 20px; width: 79%; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;');
                    this.loadedIndicator = document.createElement('div');
                    this.loadedIndicator.classList.add('tc-show');
                    this.loadedIndicator.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 0%; height: 99.99%; background-color: rgba(255,255,255,0.2);');
                    this.playedIndicator = document.createElement('div');
                    this.playedIndicator.classList.add('tc-show');
                    this.playedIndicator.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 0%; height: 99.99%; background-color: rgba(255,255,255,0.5);');
                    this.seekRange = document.createElement('input');
                    this.seekRange.classList.add('tc-show');
                    this.seekRange.setAttribute('type', 'range');
                    this.seekRange.setAttribute('min', 0);
                    this.seekRange.setAttribute('max', 100);
                    this.seekRange.setAttribute('step', 0.1);
                    this.seekRange.setAttribute('style', 'position: relative; width: 99.99%; background: none; border: none;');
                    this.progressBar.appendChild(this.loadedIndicator);
                    this.progressBar.appendChild(this.playedIndicator);
                    this.progressBar.appendChild(this.seekRange);
                    stretch.appendChild(this.progressBar);

                    // add volume section container
                    var volumeContainer = document.createElement('div');
                    volumeContainer.classList.add('tc-show');
                    volumeContainer.setAttribute('style', 'float: left; position: relative; margin: 5px 0; height: 20px; width: 20%;');
                    stretch.appendChild(volumeContainer);

                    // add mute button
                    this.btnMute = document.createElement('div');
                    this.btnMute.classList.add('tc-show');
                    this.btnMute.setAttribute('style', 'position: absolute; width: 20px; height: 20px; left: 5px; top: 0; background-color: rgba(100,100,100,0.5); color: #fff; font-size: 12px; line-height: 20px; border-radius: 3px; text-align: center; cursor: pointer');
                    this.btnMute.appendChild(document.createTextNode('\u25C1)'));
                    volumeContainer.appendChild(this.btnMute);

                    // add volumeRange bar
                    this.volumeBar = document.createElement('div');
                    this.volumeBar.classList.add('tc-show');
                    this.volumeBar.setAttribute('style', 'position: absolute; left:30px; top: 0; right: 0; bottom: 0; border: 1px solid rgba(255,255,255,0.2); border-radius: 3px; overflow: hidden;');
                    this.volumeIndicator = document.createElement('div');
                    this.volumeIndicator.classList.add('tc-show');
                    this.volumeIndicator.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 0%; height: 99.99%; background-color: rgba(255,255,255,0.2);');
                    this.volumeRange = document.createElement('input');
                    this.volumeRange.classList.add('tc-show');
                    this.volumeRange.setAttribute('type', 'range');
                    this.volumeRange.setAttribute('min', 0);
                    this.volumeRange.setAttribute('max', 100);
                    this.volumeRange.setAttribute('step', 1);
                    this.volumeRange.setAttribute('style', 'position: relative; width: 99.99%; background: none; border: none;');
                    this.updateVolume();
                    this.volumeBar.appendChild(this.volumeIndicator);
                    this.volumeBar.appendChild(this.volumeRange);
                    volumeContainer.appendChild(this.volumeBar);

                    // add TabCinema button
                    this.btnTC = document.createElement('div');
                    this.btnTC.classList.add('tc-show');
                    this.btnTC.setAttribute('style', 'position: absolute; right: 5px; top: 5px; width: 20px; height: 20px; background-color: rgba(100,100,100,0.5); color: #fff; font-size: 18px; line-height: 20px; border-radius: 3px; cursor: pointer');
                    this.btnTC.appendChild(document.createTextNode('\u25A3'));
                    this.inner.appendChild(this.btnTC);

                    // add update intervals
                    this.updatePlayedInterval = window.setInterval(this.updatePlayed, 40);

                    // add event handlers
                    this.btnPlay.addEventListener('mousedown', this.togglePlayPause);
                    this.btnTC.addEventListener('mousedown', this.exitFullScreen);
                    this.seekRange.addEventListener('mousedown', this.seekRangeMouseDown);
                    this.seekRange.addEventListener('change', this.setSeek);
                    this.seekRange.addEventListener('mouseup', this.seekRangeMouseUp);
                    this.volumeRange.addEventListener('mousedown', this.setVolume);
                    this.volumeRange.addEventListener('change', this.setVolume);
                    this.volumeRange.addEventListener('mouseup', this.setVolume);
                    this.btnMute.addEventListener('mousedown', this.toggleMute);

                    // add video event listeners
                    this.video.addEventListener('progress', this.updateLoaded);
                    this.video.addEventListener('play', this.updateState);
                    this.video.addEventListener('pause', this.updateState);
                },

                togglePlayPause: function (e) {
                    var newState = !html5controls.video.paused;
                    if (newState) {
                        html5controls.video.pause();
                    }
                    else {
                        html5controls.video.play();
                    }
                    e.stopPropagation();
                },

                seekRangeMouseDown: function (e) {
                    html5controls.wasPaused = html5controls.video.paused;
                    html5controls.video.pause();
                    e.stopPropagation();
                },

                seekRangeMouseUp: function (e) {
                    if (!html5controls.wasPaused) {
                        html5controls.video.play();
                    }
                    e.stopPropagation();
                },

                setSeek: function (e) {
                    html5controls.video.currentTime = this.value / 100 * html5controls.video.duration;
                    e.stopPropagation();
                },

                toggleMute: function (e) {
                    html5controls.video.muted = !html5controls.video.muted;
                    html5controls.updateVolume();
                    e.stopPropagation();
                },

                setVolume: function (e) {
                    if (html5controls.video.muted) {
                        html5controls.toggleMute();
                    }
                    html5controls.video.volume = this.value / 100;
                    html5controls.updateVolume();
                    e.stopPropagation();
                },

                exitFullScreen: function (e) {
                    window.top.postMessage({
                        message: 'requestEndFullscreen'
                    }, '*');
                    e.stopPropagation();
                },

                updateState: function () {
                    var isPaused = html5controls.video.paused;
                    while (html5controls.btnPlay.childNodes.length) {
                        html5controls.btnPlay.removeChild(html5controls.btnPlay.firstChild);
                    }
                    var str = isPaused ? '\u25BA' : '\u25AE\u25AE';
                    html5controls.btnPlay.appendChild(document.createTextNode(str));
                },

                updateVolume: function () {
                    if (html5controls.video.muted) {
                        html5controls.btnMute.style['backgroundColor'] = 'rgba(200,50,50,0.5)';
                        html5controls.volumeRange.value = 0;
                        html5controls.volumeIndicator.style.width = '0%';
                    }
                    else {
                        html5controls.btnMute.style['backgroundColor'] = 'rgba(100,100,100,0.5)';
                        html5controls.volumeRange.value = html5controls.video.volume * 100;
                        html5controls.volumeIndicator.style.width = html5controls.video.volume * 100 + '%';
                    }
                },

                updateLoaded: function () {
                    var tr = html5controls.video.buffered;
                    for (var i = 0; i < tr.length; i++) {
                        var ti = tr.start(i);
                        var tf = tr.end(i);
                    }
                    html5controls.loadedIndicator.style.width = 100 * tf / html5controls.video.duration + '%';
                },

                updatePlayed: function () {
                    html5controls.playedIndicator.style.width = 100 * html5controls.video.currentTime / html5controls.video.duration + '%';
                    html5controls.seekRange.value = 100 * html5controls.video.currentTime / html5controls.video.duration;
                },

                destroy: function () {

                    // clear intervals
                    window.clearInterval(this.updatePlayedInterval);

                    // strip event handlers
                    this.btnPlay.removeEventListener('mousedown', this.togglePlayPause);
                    this.btnTC.removeEventListener('mousedown', this.exitFullScreen);
                    this.seekRange.removeEventListener('mousedown', this.seekRangeMouseDown);
                    this.seekRange.removeEventListener('change', this.setSeek);
                    this.seekRange.removeEventListener('mouseup', this.seekRangeMouseUp);
                    this.volumeRange.removeEventListener('mousedown', this.setVolume);
                    this.volumeRange.removeEventListener('change', this.setVolume);
                    this.volumeRange.removeEventListener('mouseup', this.setVolume);
                    this.btnMute.removeEventListener('mousedown', this.toggleMute);

                    // strip video event listeners
                    this.video.removeEventListener('progress', this.updateLoaded);
                    this.video.removeEventListener('play', this.updateState);
                    this.video.removeEventListener('pause', this.updateState);

                    // remove controls from DOM tree
                    this.container.parentNode.removeChild(this.container);
                    html5controls = null;
                }
            };

            html5controls.construct();

            return html5controls;
        }
    };
}
