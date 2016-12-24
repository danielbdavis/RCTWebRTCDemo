
var FirebaseCommon = require ('./FirebaseSigChannelCommon');
var Util = require ('./PluotUtil');

exports.init = init;

//

function init (session_id, disp) {

  var s = {};
  s.session_id = session_id;
  s.dispatcher = disp;

  s.sessionId = function () {
    return s.session_id;
  }

  s.connect = connect;
  s.disconnect = disconnect;
  s.joinMtg = joinMtg;

  s.SERVER_TIMESTAMP = FirebaseCommon.SERVER_TIMESTAMP;

  // these function entries will be replaced as the signaling channel
  // is connected and configured
  //
  s.sendSigMsg         = function () { console.error ('not yet'); }
  s.connectedPeersHash = function () { return console.error ('not yet'); }
  s.connectedPeersList = function () { return console.error ('not yet'); }
  s.setPresence        = function () { return console.error ('not yet'); }
  s.registerDialOutEvents = function () { return console.error ('not yet'); }

  return s;

  function connect () {
    return FirebaseCommon.connect (s)
      .then (function () {
        s.registerDialOutEvents = FirebaseCommon.registerDialOutEvents.bind (s);
      });
  }

  function disconnect () {
    return FirebaseCommon.disconnect (s);
  }

  function joinMtg (mtg_str, presence_info) {
    return FirebaseCommon.joinMtg (mtg_str, presence_info, s)
      .then (function (s) {
        s.registerDialOutEvents (mtg_str);
        return s;
    });
  }
}

