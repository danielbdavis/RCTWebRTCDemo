import {
  RTCSessionDescription,
  RTCIceCandidate,
} from 'react-native-webrtc';

// wrap our webkitRTCPeerConnection reference so that we don't make
// Safari unhappy. fix: there's probably a more elegant way to do
// this.
try {
  exports.RTCSessionDescription = RTCSessionDescription;
  exports.RTCIceCandidate = RTCIceCandidate;
} catch (e) {}


exports.constructRTCPeersManager = constructRTCPeersManager;

// var request = require('browser-request');

var VL = require ('./VidLib');

//
// usage:
//
//  rtcpeers = PC.constructRTCPeersManager ();
//  rtcpeers.installLogFunctions (log, logC, logN);
//  rtcpeers.setDispatcher (dispatcher);
//
//  rtcpeers.setAcceptCalls (true, sig_channel, participation_type);
//
//  rtcpeers.closeConnections ();
//
//  // cam stream can be set before or after initiateCall()
//  rtcpeers.setCamStream (local_cam_stream, sig_channel);
//
//  rtcpeers.setScreenStream (local_cam_stream, sig_channel);
//  rtcpeers.stopScreenStream (local_cam_stream, sig_channel);
//
//  rtcpeers.renegotiateAll();
//
//  // resolve()s with null pass-along arg
//  promise = rtcpeers.initiateCall (peer.id, peer.participation_type);
//
//  // resolve()s with a single pass-along arg suitable for printing
//  // out or logging.
//  promise = rtcpeers.fetchStats ();

function constructRTCPeersManager () {
  var c = {};                   // self

  var live_peers = {},          // live RTC peers
      accepting_calls = false,  // we are or are not accepting new calls
      dispatcher,
      sig_channel,
      local_participation_type,
      local_device_type,
      local_network_type,
      local_cam_stream,
      local_screen_stream,
      logC = console.log.bind (console),
      logN = function () {},
      log = logC,
      // fix: go through and implement error handling properly
      // everywhere we call error_handler or console.error.
      error_handler = console.error.bind (console);

  c.installLogFunctions = function (log_, log_c, log_n) {
    log = log_;
    logC = log_c;
    logN = log_n;
  }

  c.setDispatcher = function (disp) {
    dispatcher = disp;
  }

  c.setAcceptCalls = function (bool, options) {
    accepting_calls = bool;
    sig_channel = options.sig_channel;
    local_participation_type = options.participation_type;
    local_device_type = options.device_type || 'browser';
    local_network_type = options.network_type || 'low';
    if (accepting_calls) {
      if (! sig_channel) {
        console.error ("can't accept calls without a signalling channel");
        return;
      }
    }
  }

  c.closeConnections = function () {
    accepting_calls = false;
    c.livePeers().forEach (function (peer_id) {
      var rtc = live_peers[peer_id].rtc;
      if (rtc) {
        rtc.close ();
      }
      delete live_peers[peer_id].rtc;
      delete live_peers[peer_id];
      dispatcher.evtRTCPeerDisconnect (peer_id);
    });
  }

  c.initiateCall = function (peer_id, peer_participation_type) {
    if (! peer_id) {
      return Promise.reject ('initiate call func but no peer id');
    }

    if (live_peers[peer_id]) {
      // fix: we see this occasionally. clean up the disconnect handling
      // logic to make sure there's not a timing issue on, say, page
      // reload
      return Promise.reject ('initiate call to peer we already know '+peer_id);
    }

    if (local_participation_type === 'screen-sharing-only'  &&
        peer_participation_type === 'screen-sharing-only') {
      return Promise.resolve ();
    }

    return new Promise (function (resolve_call_connected,
                                     reject_call_failed) {
      live_peers[peer_id] = {};
      live_peers[peer_id]._offerer = true;
      createRTCConnection (peer_id, peer_participation_type,
                           resolve_call_connected, reject_call_failed)
        .then (function (conn) {
          live_peers[peer_id].rtc = conn;
          createOffer (live_peers[peer_id].rtc, peer_id);
        });
    });
  }

  c.fetchStats = function () {
    var copied_stats = {},
        promises = [];
    // create an array of promises, one for each rtc peer
    // connection. inside the promise, wait for the asynchronous
    // getStats() function to return, then call our format method
    Object.keys (live_peers).forEach (function (peer_id) {
      if (live_peers[peer_id] && live_peers[peer_id].rtc) {
        promises.push (new Promise (function (resolve, reject) {
          live_peers[peer_id].rtc.getStats (function (sr) {
            copied_stats[peer_id] = fmt_stats_result (peer_id, sr);
            // console.log ("sr result", sr.result());
            resolve ();
          });
        }));
      }
    });
    return new Promise (function (resolve, reject) {
      Promise.all (promises).then (function () {
        resolve (copied_stats);
      });
    });
  }

  c.setCamStream = function (stream) {
    var old_stream = local_cam_stream;
    local_cam_stream = stream;
    Object.keys (live_peers).forEach(function (peer_id) {
      if (old_stream) {
        live_peers[peer_id].rtc.removeStream(old_stream);
      }
      live_peers[peer_id].rtc.addStream(local_cam_stream);
    });
    c.renegotiateAll();
  }

  c.setScreenStream = function (stream) {
    local_screen_stream = stream;
    Object.keys(live_peers).forEach(function (peer_id) {
      live_peers[peer_id].rtc.addStream(stream);
    });
    c.renegotiateAll();
  }

  c.stopScreenStream = function () {
    Object.keys(live_peers).forEach(function (peer_id) {
      live_peers[peer_id].rtc.removeStream(local_screen_stream);
    });
    local_screen_stream = null;
    c.renegotiateAll();
  }

  c.renegotiateAll = function () {
    Object.keys (live_peers).forEach(function (peer_id) {
      if (c.isOffererP(peer_id)) {
        c.renegotiate(peer_id);
      } else {
        sig_channel.sendSigMsg('please renegotiate', {}, peer_id);
      }
    });
  }

  c.muteCamStream = function (options) {
    Object.keys (live_peers).filter
      (function (peer_id) {
        sig_channel.sendSigMsg ('video muted', options, peer_id);
      });
  }

  c.unMuteCamStream = function (options) {
    Object.keys (live_peers).filter
      (function (peer_id) {
        sig_channel.sendSigMsg ('video unmuted', options, peer_id);
      });
  }

  c.livePeers = function () {
    return Object.keys (live_peers).filter
      (function (el) {
        return live_peers[el].rtc && live_peers[el].rtc._live;
      });
  }

  c.livePeersCount = function () {
    return c.livePeers().length;
  }

  c.renegotiate = function (peer_id) {
    var peer = live_peers[peer_id],
        renegotiation_thunk;
    if (! (peer && peer.rtc)) {
      console.error ('renegotiation request but no rtcpc', peer_id);
      return;
    }
    // set up a data structure for queing up renegotiations, "locked"
    // according to the _negotiating flag set here and by
    // onsignalingstatechange
    if (! peer.pending_renegotiations) {
      peer.pending_renegotiations = {
        q: [],
        interval: setInterval (function () {
          var next;
          if (! (peer.rtc && peer.rtc._negotiating)) {
            while (peer.pending_renegotiations.q.length) {
              next = peer.pending_renegotiations.q.shift ();
            }
            if (next) {
              next ();
            }
          }
        }, 500)
      }
    }
    // make a little closure that triggers a renegotiation by sending
    // a new offer, and push it onto our pending queue
    renegotiation_thunk = function () {
      peer.rtc._negotiating = true;
      createOffer (peer.rtc, peer_id);
    };
    peer.pending_renegotiations.q.push (renegotiation_thunk);
  }

  // -----

  c.evtPeerInfo = function (evt_name, peer_id, data, session_id) {
    if (peer_id === session_id) { return; }
    if (evt_name === 'connect') {
      log ("peer connect", { peer_id: peer_id });
    } else if (evt_name === 'update') {
    } else if (evt_name === 'disconnect') {
      log ("peer disconnect", { peer_id: peer_id });
      if (! live_peers[peer_id]) return;
      var rtc = live_peers[peer_id].rtc;
      if (rtc) {
        rtc.close ();
      }
      if (live_peers[peer_id].pending_renegotiations) {
        clearInterval (live_peers[peer_id].pending_renegotiations.interval);
        delete live_peers[peer_id].pending_renegotiations;
      }
      delete live_peers[peer_id].rtc;
      delete live_peers[peer_id];
      dispatcher.evtRTCPeerDisconnect (peer_id);
    }
  }

  // -----

  c.isOffererP = function (peer_id) {
    return live_peers[peer_id]._offerer;
  }

  c.msgPeerPleaseRenegotiate = function (m) {
    if ((! accepting_calls) || (! _msgToMeP(m))) return;
    c.renegotiate (m.from);
  }

  c.msgPeerSDPOffer = function (m) {
    if ((! accepting_calls) || (! _msgToMeP(m))) return;
    var peer_id = m.from,
        offer = JSON.parse (m.offer),
        promise;
    logC ('recved sdp offer from', peer_id);
    logN ('recved sdp offer', { peer_id: peer_id, offer: m.offer });

    (new Promise (function (resolve, reject) {
      if (! live_peers[peer_id]) {
        // new peer we haven't seen before
        live_peers[peer_id] = {};
        createRTCConnection (peer_id, m.participation_type)
          .then (function (conn) {
            live_peers[peer_id].rtc = conn;
            resolve (conn);
          });
      } else {
        resolve (live_peers[peer_id].rtc);
      }
    })).then (function (conn) {
      conn._camStreamId = m.camStreamId;
      conn._screenStreamId = m.screenStreamId;
      createAnswer (conn, peer_id, offer, m);
    });
  }

  c.msgPeerSDPAnswer = function (m) {
    if ((! accepting_calls) || (! _msgToMeP(m))) return;
    var peer_id = m.from,
        answer = JSON.parse (m.answer),
        conn;
    logC ('recved sdp answer from', peer_id);
    logN ('recved sdp answer', { peer_id: peer_id,
                                 answer: m.answer });
    if (! (live_peers[peer_id] && live_peers[peer_id].rtc)) {
      console.error ("received an unexpected sdp answer", peer_id);
      return;
    }
    conn = live_peers[peer_id].rtc;
    conn._camStreamId = m.camStreamId;
    conn._screenStreamId = m.screenStreamId;
    if (! conn._cached_description) {
      console.error ('need a cached description, do not have one');
      return;
    }
    conn.setLocalDescription (conn._cached_description, error_handler);
    // set our send bandwidth
    if (dispatcher.callbackSetVideoCap) {
      dispatcher.callbackSetVideoCap(answer, m.device_type, m.network_type);
    }
    conn.setRemoteDescription (new RTCSessionDescription (answer),
                               function () {}, error_handler);
  }

  c.msgPeerICECandidate = function (m) {
    if ((! accepting_calls) || (! _msgToMeP(m))) return;
    var peer_id = m.from,
        candidate = JSON.parse (m.candidate);
    logC ('recved ice candidate from', peer_id);
    logN ('recved ice candidate', { peer_id: peer_id, candidate: m.candidate });
    if (! (live_peers[peer_id] && live_peers[peer_id].rtc)) {
      console.error ("received an unexpected ice candidate", peer_id);
      return;
    }
    if (candidate) {
      // possibly a null candidate indicates the end of the candidate trickle?
      live_peers[peer_id].rtc.addIceCandidate
        ( new RTCIceCandidate(candidate),
          function () { }, // console.debug msg would be nice
          function (err) { console.error (err, candidate); }
        );
    }
  }

  function _msgToMeP (m) {
    if (! (m.channel && m.channel.sessionId)) return null;
    // console.log ("msg", m);
    return m.envelope_to === m.channel.sessionId();
  }

  // -----

  function createRTCConnection (peer_id, participation_type,
                                resolve_call_connected,
                                reject_call_failed) {
    return get_peer_conn_setup ()
      .then (function (setup) {
        var conn = new VL.RTCPeerConnection (setup.config, setup.constraints);
        conn._peer_id = peer_id;
        conn._live = false;
        conn._camStreamId = '';    // also: conn._camStream;
        conn._screenStreamId = ''; // also: conn._screenStream;
        conn._participation_type = participation_type;

        if (conn._participation_type === 'full') {
          if (local_cam_stream) { conn.addStream (local_cam_stream); }
          if (local_screen_stream) { conn.addStream (local_screen_stream); }
        }

        conn.onsignalingstatechange = function (event) {
          log ('signaling state change', { peer_id: peer_id,
                                           state: conn.signalingState });
          if (conn.signalingState === 'have-local-offer' ||
              conn.signalingState === 'have-remote-offer') {
            conn._negotiating = true;
          } else if (conn.signalingState === 'stable') {
            conn._negotiating = false;
          }
        }
        conn.onicecandidate = function (e) {
          // log ('local machinery ice cand', e.candidate);
          if (e.candidate === null) {
            log ('local machinery finished gathering ice candidates');
          }
          sendICECandidateTo (e, peer_id);
        }
        conn.onaddstream = function (evt) {
          if (conn._camStreamId === evt.stream.id) {
            log ('adding remote cam stream', { peer_id: peer_id,
                                               stream_id: evt.stream.id });
            conn._camStream = evt.stream;
            if (conn._live) {
              dispatcher.evtNewCamStream (peer_id, conn._camStream);
            }
          } else if (conn._screenStreamId === evt.stream.id) {
            log ('adding remote screen stream', { peer_id: peer_id,
                                                  stream_id: evt.stream.id });
            conn._screenStream = evt.stream;
            if (conn._live) {
              dispatcher.evtNewScreenStream (peer_id, evt.stream);
            }
          } else {
            log ('onaddstream called but unknown stream id',
                 peer_id, evt.stream.id);
          }
        }
        conn.onremovestream = function (evt) {
          log ('removing remote stream', peer_id, evt.stream.id);
          // only handle screen share removal, at the moment
          if (conn._screenStream && (! conn._screenStreamId)) {
            conn._screenStream = null;
            dispatcher.evtScreenStreamStop (peer_id, conn._camStream)
          }
        }
        conn.onnegotiationneeded = function (evt) {
          // we track when renegotiation is needed ourselves, so we don't
          // pay attention to this event. at least not currently.
          // console.debug ("rtcpc on negotion needed", evt);
        }
        conn.oniceconnectionstatechange = function (e) {
          log ('connection state change', { peer_id: peer_id,
                                            state: conn.iceConnectionState });
          if ((conn.iceConnectionState === 'connected' ||
               conn.iceConnectionState === 'completed') &&
              conn._live === false) {
            conn._live = true;
            dispatcher.evtNewRTCPeer
              (peer_id, conn._camStream, conn._screenStream, participation_type,
               resolve_call_connected, reject_call_failed);
          } else if (conn.iceConnectionState === 'disconnected') {
            // nothing to do here except hope that the webrtc machinery
            // reconnects. for now, at least. maybe we can get smarter
            // about this.
          }
          // fix: occasionally we see "completed" event but never see
          // "connected" event. this may be a bug in
          // chrome. webrtc-internals shows a connected state and then a
          // completed state. but ... we should handle, anyway. maybe
          // retry the call if this appears to happen?
        }
        return conn;
      })
    .catch(function (err) {
      console.error('createRTCConnection failure', err);
    });
  }

  function createOffer (rtc, peer_id) {
    var constraints = (local_participation_type !== 'full') ?
      { mandatory: {
          OfferToReceiveAudio: false,
          OfferToReceiveVideo: false
        }
      }  :
        { mandatory: {
          OfferToReceiveAudio: true,
          OfferToReceiveVideo: true
        }
      };

    rtc.createOffer
        (function (rtcSDP) {
          // cache our session description. we'll wait to use this
          // in setLocalDescription until we get a peer answer back.
          // this avoids starting to gather ice candidates before
          // the peer we're talking to is ready for them.
          rtc._cached_description = rtcSDP;
          sendSDPOfferTo (rtcSDP, peer_id);
        },
         error_handler,
         constraints);
  }

  function createAnswer (rtc, peer_id, offer, m) {
    var constraints =  (local_participation_type !== 'full') ?
      { mandatory: {
          OfferToReceiveAudio: false,
          OfferToReceiveVideo: false
        }
      }  :
        { mandatory: {
          OfferToReceiveAudio: true,
          OfferToReceiveVideo: true
        }
      };

    // set our send bandwidth
    if (dispatcher.callbackSetVideoCap) {
      dispatcher.callbackSetVideoCap(offer, m.device_type, m.network_type);
    }

    rtc.setRemoteDescription
      ( new RTCSessionDescription(offer),
        // setRemoteDescription success callback
        function () {
          rtc.createAnswer
            (// createAnswer success callback
             function (rtcSDP) {
               rtc.setLocalDescription
               (rtcSDP,
                // setLocalDescription success callback
                function () {
                  sendSDPAnswerTo (rtcSDP, peer_id);
                },
                // setLocalDescription failure callback
                error_handler
               );},
              // createAnswer failure callback
              error_handler,
              constraints
            );
        },
        // setRemoteDescription failure callback
        error_handler
      );}

  function sendSDPOfferTo (description, to_id) {
    var body = { offer: JSON.stringify (description),
                 participation_type: local_participation_type,
                 device_type: local_device_type,
                 network_type: local_network_type
               };
    if (local_cam_stream)    { body.camStreamId = local_cam_stream.id; }
    if (local_screen_stream) { body.screenStreamId = local_screen_stream.id; }
    logC ('sending sdp offer to', to_id);
    logN ('sending sdp offer', { peer_id: to_id, description: body.offer });
    sig_channel.sendSigMsg ('sdp offer', body, to_id);
  }

  function sendSDPAnswerTo (description, to_id) {
    var body = { answer: JSON.stringify (description),
                 participation_type: local_participation_type,
                 device_type: local_device_type,
                 network_type: local_network_type
               };
    if (local_cam_stream)    { body.camStreamId = local_cam_stream.id; }
    if (local_screen_stream) { body.screenStreamId = local_screen_stream.id; }
    logC ('sending sdp answer to', to_id);
    logN ('sending sdp answer', { peer_id: to_id, description: body.answer });
    sig_channel.sendSigMsg ('sdp answer', body, to_id);
  }

  function sendICECandidateTo (ice_event_struct, to_id) {
    var candidate = JSON.stringify (ice_event_struct.candidate);
    logC ('sending ice candidate to', to_id);
    logN ('sending ice candidate', { peer_id: to_id, candidate: candidate });
    sig_channel.sendSigMsg ('ice candidate', { candidate: candidate }, to_id);
  }


  // we did more sophisticated copying of stats data in commit
  // a648d93a1530694 and earlier. here we just pull out bweforvideo
  function fmt_stats_result (peer_id, stats_list) {
    const now = Date.now();
    var peer_record = live_peers[peer_id];
    if (! peer_record.rtc_stats_cache ) {
      peer_record.rtc_stats_cache = {};
    }
    var fmted_stats = {};
    stats_list
      .result()
      .forEach (function (stats_report_obj) {
        if (stats_report_obj.id === 'bweforvideo' ||
            stats_report_obj.type === 'ssrc') {
          var stats = { id:        stats_report_obj.id,
                        type:      stats_report_obj.type,
                        timestamp: stats_report_obj.timestamp.valueOf() };
          // FIX: this is a hack that we might not need, and should
          // definitely understand, either way. we need to ignore ssrc
          // entries that have old timestamps, or our CallStats
          // hasAudioBug calculations get confused, because we have
          // old 'ssrc_FOO_send' entries hanging around, now. but
          // only, apparently, on our box hardware. maybe this is a
          // Chrome 53 thing? maybe it has to do with resolution or
          // camera handling? not sure. see the discussion on Slack on
          // 10/31 about a reproducible box bug in which boxes are
          // bumped out of meetings by a 'has_audio_bug' event.
          if ((now - stats.timestamp) > 2000) {
            return;
          }
          stats_report_obj.names().forEach (function (name) {
            stats[name] = stats_report_obj.stat (name);
          });
          fmted_stats[stats_report_obj.id] = stats;
        }
      });
    return fmted_stats;
  }

  return c;
}

// fix: put this in PluotUtil, maybe? we should probably be switching
// to use the localhost proxy if we're in debug mode. (or maybe
// not. the heroku microservice won't change very often.) and we
// should probably have a flag that lets us turn off TURN, or use the
// google stun server for debugging.

function get_peer_conn_setup () {
  var v = {};
  // v.config = {"iceServers":[{"urls":"stun:stun.l.google.com:19302"}]};
  v.constraints = {
    "optional": [  {   "googCpuOveruseDetection": true  } ]
  };

  // return new Promise (function (resolve, reject) {
  //   request ('https://pluot-blue.herokuapp.com/tt-150331.json',
  //            function(err, res) {
  //     v.config = { iceServers: [{"url":"stun:stun.l.google.com:19302"},
  //                               ...JSON.parse(res.body)] }; // fix: try/catch?
  //     console.log('servers config', v);
  //     if (err) {
  //       reject (err);
  //     }
  //     // console.log ('conn setup values', v); fix: log these to cloud?
  //     resolve (v);
  //   });
  // });

  return Promise.resolve(v)
}
