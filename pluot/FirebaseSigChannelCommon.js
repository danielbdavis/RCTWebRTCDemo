
var Util = require ('./PluotUtil');
var Firebase = require ('firebase');

Firebase.initializeApp(Util.getFirebaseConfig());

var proto_root = require ('./ProtocolRoot'),
    raw_root_ref = Firebase.database().ref(),
    root_ref = raw_root_ref.child(proto_root);


exports.getRawRootRef = function () { return raw_root_ref; }
exports.getRootRef = function () { return root_ref; }
exports.getMtgSigChanRef = function (mtg_str) {
  return root_ref.child('meetings').child(mtg_str).child ('msgs');
}
exports.getMtgDialOutsRef = function (mtg_str) {
  return root_ref.child('meetings').child(mtg_str).child ('dial-outs');
}
exports.updateUIShellChannelRefs = function (s, channel_name) {
  s.shell_channel_ref = root_ref.child('ui-shell').child(channel_name);
  s.shell_msgs_ref    = s.shell_channel_ref.child ('msgs');
  s.shell_state_ref   = s.shell_channel_ref.child ('shell_state');
}

exports.connect = connect;
exports.disconnect = disconnect;
exports.presencesRef = presencesRef;
exports.sendMsg = sendMsg;
exports.joinMtg = joinMtg;
exports.fmtPresence = fmtPresence;
exports.setPresence = setPresence;
exports.addDialOut = addDialOut;
exports.removeDialOut = removeDialOut;
exports.registerDialOutEvents = registerDialOutEvents;

exports.SERVER_TIMESTAMP = Firebase.database.ServerValue.TIMESTAMP;

//

function connect (s) {
  var sid = s.session_id;
  s.do_first_connect = true;

  // we return a promise, setting up a Firebase hook that will allow
  // us to resolve that promise on first connection

  return new Promise (function (resolve, reject) {
    Firebase.database().ref('.info/connected').on ('value', function (snap) {
      if (snap.val() !== true) {
        // this means we're not connected. we reliably get this once
        // initially before we get connected the first time.
        if (s.do_first_connect) {
          return;
        } else {
          s.dispatcher.evtFirebaseDisconnect ();
          return;
        }
      }

      if (! s.do_first_connect) {
        s.dispatcher.evtFirebaseReconnect ();
        return;
      }

      // initial connection!
      s.do_first_connect = false;

      // fix: maybe squirrel away clock skew so we can do useful
      // things with timestamps? see web-connect/fb-bug.html for an
      // example.

      resolve (s);
    });
  });
}

// fix: think through this -- non-reversible (in other words, we don't
// do any cleanup of data structures or hooks or anything. so you
// can't call goOnline after this.) currently, only call this method
// as part of a final app cleanup. only way to recover is to reload
// completely. also, in light of this, we might want to put a flag in
// that disables all firebase methods (throws an error). because the
// firebase library will keep on happily doing things locally even
// when it's disconnected.
function disconnect (s) {
  Firebase.database().goOffline ();
}

function joinMtg (mtg_str, presence_info, s) {
  s.mtg_str = mtg_str;
  s.msgs_ref = exports.getMtgSigChanRef (mtg_str);
  s.presence_ref = presencesRef(mtg_str).child (s.session_id);

  return syncOnPresenceDeposit (s, presence_info)
           .then (checkWhetherMeetingIsFull.bind (this, s, presence_info))
           .then (syncOnInitialMessageDeposit.bind (this, s));
}

function syncOnPresenceDeposit (s, presence_info) {
  var connected_peers = {}, m;

  return new Promise (function (resolve, reject) {
    s.presence_ref.once ('value', function (snap) {
    // does a presence ref already exist? if so we're probably
    // connected from another tab. anyway, we just want to return
    // a fatal error and let the app deal with it appropriately.
      var ps = snap.val ();
      if (ps !== null) {
        reject (Error ('presence ref already exists'));
      }
      // okay. no presence ref exists that matches our
      // session_id. we're in like flynn and can continue on.
      s.presence_ref.onDisconnect().remove();

      // initialize our meeting presence entry. firebase will manage
      // the sorting, here, based on initial timestamp (with a
      // fallback sort based on entry key)
      m = fmtPresence (presence_info);
      m.initial_ts = Firebase.database.ServerValue.TIMESTAMP;
      s.presence_ref.setWithPriority (m, Firebase.database.ServerValue.TIMESTAMP);

      // wait until we see our entry in the synchronized data
      // snapshot. this ensures we know about all the peers that
      // connected before we did.
      s.presence_ref.parent.on ('value', function (snap) {
        var peers_hash = snap.val ();
        if (peers_hash && peers_hash[s.session_id]) {
          s.setPresence = setPresence.bind (null, s.presence_ref);
          // replace the value callback with a new one that caches the
          // peers_hash
          s.presence_ref.parent.off ('value');
          s.presence_ref.parent.on ('value', function (snap) {
            connected_peers = snap.val () || {};
          });
          s.connectedPeersHash = function () { return connected_peers; }
          s.connectedPeersList = function () {
            // convert the peers data to list sorted by inital_ts
            var peers_list = [];
            for (var id in connected_peers) {
              peers_list.push (connected_peers[id]);
              peers_list[peers_list.length-1]._id = id;
            }
            return peers_list;
          }

          resolve (s);
        }
      })})})
}

function checkWhetherMeetingIsFull (s, presence_info) {
  if (presence_info.participation_type !== 'full') {
    // if we're screen sharing, we can join a meeting even if it's
    // already got four full participants
    return null;
  }
  return new Promise (function (resolve, reject) {
    s.presence_ref.parent.once ('value', function (snap) {
      var ps = snap.val (),
          full_ps_count = 0;
      Object.keys (ps)
        .filter (function (k) { return k !== s.session_id })
        .forEach (function (k) {
          if (ps[k].participation_type === 'full') { full_ps_count++; }
        });
      if (full_ps_count < Util.MAX_FULL_MEETING_PARTICIPANTS) {
        resolve (s);
      } else {
        // reject with an error, so that the error is passed all the
        // way back through the Firebase infrastructure to our
        // top-level catch (if we reject with just a bare string, that
        // string doesn't get passed back to our code).
        reject (new Error ("this meeting is full at the moment."));
      }
    });
  });
}

function syncOnInitialMessageDeposit (s) {
  return new Promise (function (resolve, reject) {
    // msgs channel -- send joining message, then use that message id
    // as a start key so we process only messages received after we
    // join the msgs channel
    var starting_msg = s.msgs_ref.push (
      // message
      { tag: 'joining channel',
        from: s.session_id,
        ts: Firebase.database.ServerValue.TIMESTAMP },
        // push() method's on complete function
        function (err_or_null) {
          if (err_or_null) {
            reject (err_or_null);
          }
          // set up processing function
          s.msgs_ref.startAt (null, starting_msg.key).on ('child_added',
            function (snap) {
              var m = snap.val ();
              if (m.from === s.session_id) { return };
                m.channel = s;
                s.dispatcher.msgSigChannel (m);
              });
          starting_msg.onDisconnect().remove();
          // enact our peer connect/disconnect/update event hook callers
          s.presence_ref.parent.on ('child_added', function (snap) {
            s.dispatcher.evtPeerInfo ('connect', snap.key, snap.val(),
                                      s.session_id);
          });
          s.presence_ref.parent.on ('child_changed', function (snap) {
            s.dispatcher.evtPeerInfo ('update', snap.key, snap.val(),
                                      s.session_id);
          });
          s.presence_ref.parent.on ('child_removed', function (snap) {
            s.dispatcher.evtPeerInfo ('disconnect', snap.key, snap.val (),
                                      s.session_id);
          });

          s.sendSigMsg = sendMsg.bind (null, s.msgs_ref, s.session_id, true);

          resolve (s);
        })});
}


function sendMsg (channel_ref, session_id, remove_on_disconnect_p,
                  tag, fields, envelope_to) {
  var new_msg_ref, msg = fields || {};
  if (tag) {
    msg.tag = tag;
  }
  if (envelope_to) {
    msg.envelope_to = envelope_to;
  }
  msg.from = session_id;
  msg.ts =  Firebase.database.ServerValue.TIMESTAMP;
  new_msg_ref = channel_ref.push (msg);
  if (remove_on_disconnect_p) {
    new_msg_ref.onDisconnect().remove();
  }
  return msg;
}


function presencesRef (mtg_str) {
  return root_ref.child('meetings').child(mtg_str).child('presence');
}

function fmtPresence (status_str_or_complex_hash) {
  var m = {};
  if (status_str_or_complex_hash) {
    m = typeof status_str_or_complex_hash === 'object' ?
                 status_str_or_complex_hash :
                 { app_state: String (status_str_or_complex_hash) };
  }
  m.ts = Firebase.database.ServerValue.TIMESTAMP;
  return m;

}

function setPresence (presence_ref, status_str_or_complex_hash) {
  return new Promise (function (resolve, reject) {
    presence_ref.update (
      fmtPresence (status_str_or_complex_hash),
      function () { resolve(); }
    );
  });
}

function addDialOut (params) {
  try {
    var ref = exports.getMtgDialOutsRef (params['mtg-str']);
    ref.child (params['formatted-to']).set (params);
  } catch (e) {
    console.error ("can't add dialout: ", e);
  }
}

function removeDialOut (params) {
  var ref = exports.getMtgDialOutsRef (params['mtg-str']);
  ref.child (params['formatted-to']).remove ();
}

function registerDialOutEvents (mtg_str) {
  var self = this;
  var ref = exports.getMtgDialOutsRef (mtg_str);
  ref.on ('child_added', function (child_snap, err) {
    if (self.dispatcher  &&  self.dispatcher.evtTwilioDialOutJoin) {
      ref.once ('value', function (dial_outs_snap) {
        self.dispatcher.evtTwilioDialOutJoin (child_snap.val (),
                                              dial_outs_snap.val ());
      }, function (err) {
        console.error (err, err.stack);
      });
    }
  }, function (err) {
    console.error (err, err.stack);
  });

  ref.on ('child_removed', function (child_snap, err) {
    if (self.dispatcher  &&  self.dispatcher.evtTwilioDialOutHangup) {
      ref.once ('value', function (dial_outs_snap) {
        self.dispatcher.evtTwilioDialOutHangup (child_snap.val (),
                                                dial_outs_snap.val ());
      }, function (err) {
        console.error (err, err.stack);
      });
    }
  }, function (err) {
    console.error (err, err.stack);
  });
}
