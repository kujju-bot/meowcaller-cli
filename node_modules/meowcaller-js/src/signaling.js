export const CapabilityOffer = Buffer.from(
  'AAAAAElQAAAASVNJUEVSVEVTVEVSUFY9MC4zLjIyNjUuMCwgU1RDX1NUUlNFUlZFUj0yMCwgU1RDX1NUUlNfU0laRT0xMDQ4NTc2LCBUQ1BfU1RSU0VSVkVSPTIwLCBUQ1BfU1RSU1NJWkU9MTU3Mjg2NCwgVFVSTl9TVFJTRVJWRVI9MjAsIFRVUk5fU1RSU1NJWkU9NjU1MzYsIFNSQ1JPRVJfTE9DQUxfRElBTUVEPTE2OTUxMjI5NzI=',
  'base64'
);

export const VideoStateActive = 1;
export const VideoStateUpgrade = 11;
export const VideoCodecH264 = 'h264';

export function BuildOffer(params) {
  const { CallID, To, CallCreator, DeviceKeys, PrivacyToken, Capability, DeviceIdentity } = params;
  const children = [];

  if (DeviceKeys && DeviceKeys.length > 0) {
    for (const dk of DeviceKeys) {
      const encNode = {
        tag: 'enc',
        attrs: { type: dk.EncType, v: '2' },
        content: Array.from(dk.Ciphertext),
      };
      children.push(encNode);
    }
  }

  const audioNode = { tag: 'audio', attrs: { enc: 'opus', rate: '16000' } };
  children.push(audioNode);

  const encoptNode = { tag: 'encopt', attrs: { keygen: '2' } };
  children.push(encoptNode);

  if (Capability) {
    children.push({ tag: 'capability', attrs: { ver: '1' }, content: Array.from(Capability) });
  }

  if (DeviceIdentity) {
    children.push({ tag: 'device-identity', content: Array.from(DeviceIdentity) });
  }

  if (PrivacyToken) {
    children.push({ tag: 'privacy_token', content: Array.from(PrivacyToken) });
  }

  const attrs = {
    to: To.toString(),
    type: 'offer',
    'call-id': CallID,
    'call-creator': CallCreator.toString(),
    'edit': '1',
  };

  return { tag: 'call', attrs, content: children };
}

export function BuildAccept(params) {
  const { CallID, To, CallCreator, AudioRates, Metadata } = params;
  const children = [];

  if (AudioRates) {
    for (const rate of AudioRates) {
      children.push({ tag: 'audio', attrs: { enc: 'opus', rate } });
    }
  }

  children.push({ tag: 'encopt', attrs: { keygen: '2' } });

  if (Metadata) {
    children.push({ tag: 'meta', attrs: Metadata });
  }

  const attrs = {
    to: To.toString(),
    type: 'accept',
    'call-id': CallID,
    'call-creator': CallCreator.toString(),
  };

  return { tag: 'call', attrs, content: children };
}

export function BuildReject(callID, to, callCreator) {
  return {
    tag: 'call',
    attrs: {
      to: to.toString(),
      type: 'reject',
      'call-id': callID,
      'call-creator': callCreator.toString(),
    },
    content: [
      { tag: 'reject', attrs: {}, content: [] },
    ],
  };
}

export function BuildTerminate(params) {
  const { CallID, To, CallCreator } = params;
  return {
    tag: 'call',
    attrs: {
      to: To.toString(),
      type: 'terminate',
      'call-id': CallID,
      'call-creator': CallCreator.toString(),
    },
    content: [],
  };
}

export function BuildRelayLatency(params) {
  const { CallID, To, CallCreator, LatencyMs, RelayName, AddressBytes } = params;
  return {
    tag: 'call',
    attrs: { to: To.toString(), type: 'relaylatency', 'call-id': CallID, 'call-creator': CallCreator.toString() },
    content: [
      {
        tag: 'relaylatency',
        attrs: {},
        content: [
          {
            tag: 'te',
            attrs: { latency: String(0x02000000 + LatencyMs), relay_name: RelayName },
            content: Array.from(AddressBytes),
          },
        ],
      },
    ],
  };
}

export function BuildVideoState(callID, to, creator, id, state, orientation, codec) {
  return {
    tag: 'call',
    attrs: { to: to.toString(), id, type: 'video' },
    content: [
      {
        tag: 'video',
        attrs: {
          'call-id': callID,
          'call-creator': creator.toString(),
          state: String(state),
          orientation: String(orientation),
          'video_codec': codec,
        },
      },
    ],
  };
}

export function OfferHasVideo(data) {
  if (!data || !data.content) return false;
  const kids = Array.isArray(data.content) ? data.content : [];
  return kids.some((c) => c.tag === 'video');
}

export function ParseVoipSettings(content) {
  // voip_settings is a protobuf; stub parsing for codec selection
  try {
    const json = JSON.parse(content.toString('utf8'));
    const useV1 = json.use_mlow_codec_v1;
    return {
      present: true,
      useMlowCodecV1: useV1 !== false,
    };
  } catch {
    return null;
  }
}
