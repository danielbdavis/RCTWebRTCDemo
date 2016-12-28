'use strict';

import React, {
  Component
} from 'react';

import {
  AppRegistry,
  StyleSheet,
  Text,
  TouchableHighlight,
  View,
  TextInput,
  ListView,
} from 'react-native';

import {
  RTCView,
  getUserMedia,
} from 'react-native-webrtc';

import {
  init as SigChannelInit
} from './pluot/FirebaseSigCaller';

import {
  constructRTCPeersManager
} from './pluot/PeerConnectionWrapper';

// constants
const CONN_ESTABLISH_TIMEOUT = 20000;  // twenty seconds
const device_type = "browser";

// instance for top-level React container
let pluot;

const dispatcher = {
  msgSigChannel: function (m) {
    switch (m.tag) {
    case 'available for call':   return rtcpeers.msgPeerAvailableForCall (m);
    case 'please call':          return rtcpeers.msgPeerPleaseCall (m);
    case 'please renegotiate':   return rtcpeers.msgPeerPleaseRenegotiate (m);
    case 'sdp offer':            return rtcpeers.msgPeerSDPOffer (m);
    case 'sdp answer':           return rtcpeers.msgPeerSDPAnswer (m);
    case 'ice candidate':        return rtcpeers.msgPeerICECandidate (m);
    }
    
    console.log("fall-through sig channel message", { sig_msg: m });

    return null;
  },

  evtFirebaseDisconnect: function () {
    if (! we_are_post_shutdown) {
      fatalError('network unreachable');
    } else {
      console.log('fb disconnect');
    }
  },
  
  evtFirebaseReconnect:  function () {
    console.log('fb reconnect')
  },

  evtPeerInfo: function () {
    rtcpeers.evtPeerInfo.apply (null, arguments)
  },

  evtNewRTCPeer: handle_new_rtc_peer,
  evtNewCamStream: handle_new_cam_stream,
  evtNewScreenStream: handle_new_screen_stream,
  evtScreenStreamStop: handle_stop_screen_stream,
  evtRTCPeerDisconnect: handle_rtc_peer_disconnect,
  evtTwilioDialOutHangup: function (child_data, dial_outs_data) {
    if (dial_outs_data === null) {
      switchOutOfAudioConf ();
    }
  },
  
  evtTwilioDialOutJoin: function (child_data, dial_outs_data) {
    if (Object.keys (dial_outs_data).length === 1) {
      // fix: sanity check that call machine's meeting string matches the
      // dial_outs_data meeting string
      switchToAudioConf (Util.readGlobal ('mtg_str'));
    }
  },

  callbackSetVideoCap: function (rtcSDP, peer_device_type, peer_network_type) {
    let low_bcap = 768;
    let high_bcap = 1280;
    let peers_count = fullPeersCount()-1;
    let bcap = 0;
    if (peers_count < 1) {
      console.log('very strange peers count error in callbackSetVideoCap');
      return rtcSDP;
    }
    if (window && window.bandwidthCap) {
      bcap = window.bandwidthCap;
    } else {
      console.log('bandwidth send calculations ...',
                  peers_count, peer_device_type, peer_network_type);
      // a starting value -- high for boxes on ethernet, lower otherwise
      if ((device_type === 'box') &&
          (network_type === 'high') &&
          (peer_device_type === 'box') &&
          (peer_network_type === 'high')) {
        bcap = high_bcap / peers_count;
      } else {
        bcap = low_bcap / peers_count;
      }
      console.log ('    b=AS:', bcap);
    }

    rtcSDP.sdp = rtcSDP.sdp.replace(/a=mid:video\r\nb=AS:\d+\r\n/g,
                                    'a=mid:video\r\n');
    rtcSDP.sdp = rtcSDP.sdp.replace(/a=mid:video\r\n/g,
                                    `a=mid:video\r\nb=AS:${bcap}\r\n`);
    return rtcSDP;
  }
};

function handle_new_rtc_peer (peer_id, cam_stream, screen_stream, participation_type, resolve, reject) {
  activePeers[peer_id] = {
    peer_id, cam_stream
  }
  
  if (cam_stream) {
    pluot.setState({peers: activePeers})
  }
}

function handle_rtc_peer_disconnect (peer_id) {
  delete activePeers[peer_id]

  pluot.setState({peers: activePeers})
}

function handle_new_cam_stream (peer_id, stream, delay_layout) {
  if (stream) {
    activePeers[peer_id]["cam_stream"] = stream
    pluot.setState({peers: activePeers})
  }
}

function handle_new_screen_stream (peer_id, stream, delay_layout) {}
function handle_stop_screen_stream (peer_id, cam_stream) {}

// signaling channel
let signalingChannel = SigChannelInit("ios-test" + Date.now(), dispatcher);

// peers manager
let rtcpeers = constructRTCPeersManager();
rtcpeers.setDispatcher(dispatcher);

let activePeers = {}

let localCamStream = null;


// React native component class
const PluotDemo = React.createClass({
  getInitialState: function() {
    return {
      info: 'Initializing',
      selfViewSrc: null,
      peers: {},
    };
  },

  componentDidMount: function() {
    pluot = this;
  },

  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.welcome}>
          {"Pluot Demo\n"}
          {this.state.info}
        </Text>

        <RTCView streamURL={this.state.selfViewSrc} style={styles.streamView}/>
        {
          mapHash(this.state.peers, function(remote, index) {
            if (remote && remote.cam_stream) {
              return <RTCView key={index} streamURL={remote.cam_stream.toURL()} style={styles.streamView}/>
            }
          })
        }
      </View>
    )
  },
})

function mapHash(hash, func) {
  const array = [];
  for (const key in hash) {
    const obj = hash[key];
    array.push(func(obj, key));
  }
  return array;
}

function joinMeeting() {
  rtcpeers.setAcceptCalls(true, {
    sig_channel: signalingChannel,
    participation_type: "full",
    device_type: "browser",
    network_type: "low"
  })

  const promises = prior_active_peers().map (function (p) {
    return rtcpeers.initiateCall (p._id, p.participation_type);
  });
  
  return Promise.race
    ([Promise.all (promises), timeoutRejPromise ('timeout', CONN_ESTABLISH_TIMEOUT)])

}

function timeoutRejPromise (pass_through_value, timeout) {
  return new Promise (function (resolve, reject) {
    setTimeout (function () { reject (pass_through_value) }, timeout);
  });
}

// do everything

function run() {
  getLocalStream()
  .then(function(stream) {
    localCamStream = stream;

    pluot.setState({selfViewSrc: stream.toURL()});
  })
  .then(function() {
    pluot.setState({info: "local stream live"})
  })
  .then(signalingChannel.connect)
  .then(function() {
    pluot.setState({info: `connected to signaling channel: ${signalingChannel.sessionId()}`})
  })
  .then(function() {
    var initial_presence_ref =  {
          join_mtg_ts:        signalingChannel.SERVER_TIMESTAMP,
          app_state:          'present',
          device_type:        'browser',
          layout_style:       'browser',
          participation_type: 'full',
          meeting_name:       'AAAAAAAAAAAA'
        }
    return signalingChannel.joinMtg('AAAAAAAAAAAA', initial_presence_ref)
  })
  .then(joinMeeting)
  .then(function() {
    rtcpeers.setCamStream(localCamStream, signalingChannel);
  })
  .then(function() {
    pluot.setState({info: "joined meeting"})
  })
  .catch(function(error) {
    pluot.setState({info: error.message})
  })
}

// ----- info and connection management utilities -----

function prior_active_peers () {
  return prior_peers
    (signalingChannel.connectedPeersList().slice().filter(function (p) {
        return p.join_mtg_ts;
    }));
}

// the slice of a peers list that precedes our entry. if no list is
// passed in, we use the current connectedPeersList()
function prior_peers (list) {
  if (! signalingChannel) {
    return [];
  }
  if (! list) {
    list = signalingChannel.connectedPeersList();
  }
  for (var i=0; i < list.length; i++) {
    if (list[i]._id === signalingChannel.sessionId())
      break;
  }
  return list.slice(0, i);
}

function fullPeersCount () {
  return signalingChannel.connectedPeersList().filter(function (p) {
    return is_full_peer(p);
  }).length;
}

// test whether a peer is a "full" peer, meaning it intends to be a
// full-duplex meeting participant. (not just, say, a screen sharer).
function is_full_peer (p) {
  if (p.participation_type) {
    return (p.participation_type === 'full');
  } else {
    return signalingChannel.connectedPeersHash[p].participation_type;
  }
}

// connect to video camera

function getLocalStream() {
  return new Promise(function(resolve, reject) {
    getUserMedia({
      audio: true,
      video: {
        mandatory: {
          minWidth: 500,
          minHeight: 300,
          minFrameRate: 30
        },
        facingMode: "user",
      }
    }, function(stream) {
      resolve(stream)
    }, function(error) {
      reject(error)
    })
  })
}

window.setTimeout(() => {run()}, 1000)

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#F5FCFF',
  },
  welcome: {
    fontSize: 20,
    textAlign: 'center',
    margin: 10,
  },

  streamView: {
    width: 200,
    height: 150,
    justifyContent: 'center',
    backgroundColor: 'black',
  },
  
});

AppRegistry.registerComponent('PluotDemo', () => PluotDemo);