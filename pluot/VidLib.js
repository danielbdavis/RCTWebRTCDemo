import {
  RTCPeerConnection,
} from 'react-native-webrtc';

// wrap our webkitRTCPeerConnection reference so that we don't make
// Safari unhappy. fix: there's probably a more elegant way to do
// this.
try {
  exports.RTCPeerConnection = RTCPeerConnection;
} catch (e) {}

exports.getCamStream    = getCamStream;
exports.getScreenStream = getScreenStream;
exports.maybeAdjustOutgoingResolution = maybeAdjustOutgoingResolution;
exports.forceAdjustOutgoingResolution = forceAdjustOutgoingResolution;

var camResolutionManager =
  { currentWidth: 0,
    currentHeight: 0,
    prospectiveWidth: 0,   // prospective w/h are different from current
    prospectiveHeight: 0,  // w/h when we are delaying resetting cam res
    lastCamReset: 0,
    minSecsBetweenCamReset: 10,
    queuedDelayK: null
  };

function getCamStream (dims, opts) {
  return new Promise (function (resolve, reject) {
    navigator.webkitGetUserMedia(getCamGumConstraints(
                                   dims.width, dims.height, opts),
      function (stream) { resolve (stream); },
      function (err) {
        if (err.name === "PermissionDismissedError" || 
            err.name === "PermissionDeniedError"    ||
            err.name === "DevicesNotFoundError") {
          reject (err);
          //resolve({ videoAudioMuted: true });
        } else {
          reject (err);
        }
      }
    );
  });
}

function getScreenStream (media_source_id, got_stream_k, error_k) {
  screenGumConstraints.video.mandatory.chromeMediaSourceId = media_source_id;
  navigator.webkitGetUserMedia (screenGumConstraints, got_stream_k, error_k);
}



function getCamStream_old_and_more_complicated
  (my_layout_style, live_peers, got_stream_k, error_k) {
  window.clearTimeout (camResolutionManager.queuedDelayK);
  var svr = getSituationalVideoResolution (my_layout_style, live_peers);
  camResolutionManager.currentWidth = camResolutionManager.prospectiveWidth =
    svr[0];
  camResolutionManager.currentHeight =camResolutionManager.prospectiveHeight =
    svr[1];
  camResolutionManager.lastCamReset = Date.now ();
  navigator.webkitGetUserMedia (getCamGumConstraints(svr[0], svr[1]),
                                got_stream_k, error_k);
}

// fix: this should be rewritten to be more conservative. first, we
// should be basing the resolutions on the presence peer info we
// have. second, we should delay a bit before adjusting resolution
// when we see a new peer or whatever.  (maybe that delay goes in the
// vid handler functions, though.) third: let's write our video
// resolution into our presence entry.
function maybeAdjustOutgoingResolution (my_layout_style, live_peers,
                                        ifNeedsAdjustingK) {
  var now = Date.now ();
  var millis = now - camResolutionManager.lastCamReset;
  var delay = (millis < (camResolutionManager.minSecsBetweenCamReset*1000)) ?
    (camResolutionManager.minSecsBetweenCamReset*1000)-millis : 0;
  var svr = getSituationalVideoResolution (my_layout_style, live_peers);

  if ((svr[0] !== camResolutionManager.prospectiveWidth) ||
      (svr[1] !== camResolutionManager.prospectiveHeight)) {
    var adjF = function () {
      // console.log ('adjusting local cam resolution');
      getCamStream (my_layout_style, live_peers, ifNeedsAdjustingK,
        function (error) { console.error ("could not adjust local resolution"); });
    }
    if (delay > 0) {
      window.clearTimeout (camResolutionManager.queuedDelayK);
      camResolutionManager.queuedDelayK = window.setTimeout (adjF, delay);
    } else {
      adjF ();
    }
  } else {
    // console.log ("NOT ADJUSTING RESOLUTION");
  }
  return;
}

function forceAdjustOutgoingResolution (w, h, k) {
  console.log ("FORCE ADJUSTING RES");
  camResolutionManager.currentWidth = w;
  camResolutionManager.currentHeight = h;
  camResolutionManager.lastCamReset = Date.now ();
  navigator.webkitGetUserMedia (getCamGumConstraints(w, h), k,
    function (error) { console.error ("could not adjust local resolution"); });
}

//

// fix: as stated in the fix-comment above: this should be based on
// the presence peers info, not live peers.
function getSituationalVideoResolution (my_layout_style, live_peers) {
  return [640, 360];
  // console.log ("LIVE PEERS:", live_peers.length);
  if (live_peers.length < 2) {
    return [1280, 720];
  }
  // return [184, 104];
  return [640, 360];
}

//

function getCamGumConstraints (width, height, opts) {
  if (! width) {
    width = 1280;
    height = 720;
  }

  var constraints = {
    audio: {
      optional: [ {googEchoCancellation:             true},
                  {googAutoGainControl:              true},
                  {googNoiseSuppression:             true},
                  {googAudioMirroring:               false},
                  {googHighpassFilter:               true} ]
    },
    video: { optional: [ {googNoiseReduction:      true},
                         {minWidth:                width},
                         {minHeight:               height} ],
             mandatory: {
               minAspectRatio: 1.77,
               maxWidth: width,
               maxHeight: height
             }
           }
  };
  if (opts && opts.video_only) {
    constraints.audio = false;
  }
  return constraints;
}
