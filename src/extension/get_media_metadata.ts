import mp4box from 'mp4box';

// export function getVideoDuration(buffer: Buffer) {
//   const header = Buffer.from('mvhd');
//   const start = buffer.indexOf(header) + 16;
//   const timeScale = buffer.readUInt32BE(start);
//   const duration = buffer.readUInt32BE(start + 4);

//   return Math.floor(duration / timeScale);
// }

/**
 * Example:
 {
  hasMoov: true,
  duration: 32502,
  timescale: 1000,
  isFragmented: false,
  isProgressive: false,
  hasIOD: false,
  brands: [ 'isom', 'isom', 'iso2', 'avc1', 'mp41' ],
  created: 1904-01-01T00:00:00.000Z,
  modified: 1904-01-01T00:00:00.000Z,
  tracks: [
    {
      id: 1,
      name: 'VideoHandler',
      references: [],
      edits: [
        {
          segment_duration: 32480,
          media_time: 1024,
          media_rate_integer: 1,
          media_rate_fraction: 0
        }
      ],
      created: 1904-01-01T00:00:00.000Z,
      modified: 1904-01-01T00:00:00.000Z,
      movie_duration: 32480,
      movie_timescale: 1000,
      layer: 0,
      alternate_group: 0,
      volume: 0,
      matrix: Int32Array(9) [ 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824 ],
      track_width: 640,
      track_height: 360,
      timescale: 12800,
      cts_shift: undefined,
      duration: 415744,
      samples_duration: 415744,
      codec: 'avc1.64001e',
      kind: { schemeURI: '', value: '' },
      language: 'eng',
      nb_samples: 812,
      size: 1386359,
      bitrate: 341467.73399014777,
      type: 'video',
      video: { width: 640, height: 360 }
    },
    {
      id: 2,
      name: 'SoundHandler',
      references: [],
      edits: [
        {
          segment_duration: 32501,
          media_time: 532,
          media_rate_integer: 1,
          media_rate_fraction: 0
        }
      ],
      created: 1904-01-01T00:00:00.000Z,
      modified: 1904-01-01T00:00:00.000Z,
      movie_duration: 32502,
      movie_timescale: 1000,
      layer: 0,
      alternate_group: 1,
      volume: 1,
      matrix: Int32Array(9) [ 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824 ],
      track_width: 0,
      track_height: 0,
      timescale: 44100,
      cts_shift: undefined,
      duration: 1433304,
      samples_duration: 1433304,
      codec: 'mp4a.6b',
      kind: { schemeURI: '', value: '' },
      language: 'eng',
      nb_samples: 1245,
      size: 260179,
      bitrate: 64041.648666298286,
      type: 'audio',
      audio: { sample_rate: 44100, channel_count: 2, sample_size: 16 }
    }
  ],
  audioTracks: [
    {
      id: 2,
      name: 'SoundHandler',
      references: [],
      edits: [
        {
          segment_duration: 32501,
          media_time: 532,
          media_rate_integer: 1,
          media_rate_fraction: 0
        }
      ],
      created: 1904-01-01T00:00:00.000Z,
      modified: 1904-01-01T00:00:00.000Z,
      movie_duration: 32502,
      movie_timescale: 1000,
      layer: 0,
      alternate_group: 1,
      volume: 1,
      matrix: Int32Array(9) [ 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824 ],
      track_width: 0,
      track_height: 0,
      timescale: 44100,
      cts_shift: undefined,
      duration: 1433304,
      samples_duration: 1433304,
      codec: 'mp4a.6b',
      kind: { schemeURI: '', value: '' },
      language: 'eng',
      nb_samples: 1245,
      size: 260179,
      bitrate: 64041.648666298286,
      type: 'audio',
      audio: { sample_rate: 44100, channel_count: 2, sample_size: 16 }
    }
  ],
  videoTracks: [
    {
      id: 1,
      name: 'VideoHandler',
      references: [],
      edits: [
        {
          segment_duration: 32480,
          media_time: 1024,
          media_rate_integer: 1,
          media_rate_fraction: 0
        }
      ],
      created: 1904-01-01T00:00:00.000Z,
      modified: 1904-01-01T00:00:00.000Z,
      movie_duration: 32480,
      movie_timescale: 1000,
      layer: 0,
      alternate_group: 0,
      volume: 0,
      matrix: Int32Array(9) [ 65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824 ],
      track_width: 640,
      track_height: 360,
      timescale: 12800,
      cts_shift: undefined,
      duration: 415744,
      samples_duration: 415744,
      codec: 'avc1.64001e',
      kind: { schemeURI: '', value: '' },
      language: 'eng',
      nb_samples: 812,
      size: 1386359,
      bitrate: 341467.73399014777,
      type: 'video',
      video: { width: 640, height: 360 }
    }
  ],
  subtitleTracks: [],
  metadataTracks: [],
  hintTracks: [],
  otherTracks: [],
  mime: 'video/mp4; codecs="avc1.64001e,mp4a.6b"; profiles="isom,iso2,avc1,mp41"'
}
 */
export function getMp4MetaData(buffer: Buffer) {
  return new Promise<any>((resolve, reject) => {
    const mp4boxFile = mp4box.createFile();

    mp4boxFile.onReady = resolve;
    mp4boxFile.onError = reject;

    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    // @ts-ignore
    arrayBuffer.fileStart = 0;
    mp4boxFile.appendBuffer(arrayBuffer);
    mp4boxFile.flush();
  });
}

// Code for mp3 duration taken from https://github.com/transitive-bullshit

const versions = ['2.5', 'x', '2', '1'];
const layers = ['x', '3', '2', '1'];
const bitRates: { [key: string]: number[] } = {
  V1Lx: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  V1L1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  V1L2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  V1L3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  V2Lx: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  V2L1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  V2L2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  V2L3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  VxLx: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  VxL1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  VxL2: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  VxL3: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const sampleRates: { [key: string]: number[] } = {
  x: [0, 0, 0],
  '1': [44100, 48000, 32000],
  '2': [22050, 24000, 16000],
  '2.5': [11025, 12000, 8000],
};

const samples: { [key: string]: { [key: string]: number } } = {
  x: {
    x: 0,
    1: 0,
    2: 0,
    3: 0,
  },
  1: {
    // MPEGv1,    Layers 1, 2, 3
    x: 0,
    1: 384,
    2: 1152,
    3: 1152,
  },
  2: {
    // MPEGv2/2.5, Layers 1, 2, 3
    x: 0,
    1: 384,
    2: 1152,
    3: 576,
  },
};

export function getMp3Duration(buffer: Buffer): number {
  const scratch = Buffer.alloc(100);
  const bytesRead = buffer.copy(scratch, 0, 0, 100);
  if (bytesRead < 100) return 0;

  let offset = skipID3(scratch);
  let duration = 0;

  while (offset < buffer.length) {
    const bytesRead = buffer.copy(scratch, 0, offset, offset + 10);
    if (bytesRead < 10) return duration;

    // looking for 1111 1111 111 (frame synchronization bits)
    if (scratch[0] === 0xff && (scratch[1] & 0xe0) === 0xe0) {
      const header = parseFrameHeader(scratch);

      if (header.frameSize && header.samples) {
        offset += header.frameSize;
        duration += header.samples / header.sampleRate;
      } else {
        offset++; // corrupt file?
      }
    } else if (scratch[0] === 0x54 && scratch[1] === 0x41 && scratch[2] === 0x47) {
      // TAG
      offset += 128; // skip over id3v1 tag size
    } else {
      offset++; // corrupt file?
    }
  }

  return duration;
}

export function isMp3VBR(buffer: Buffer, maxFramesToCheck = 1000): boolean {
  const scratch = Buffer.alloc(100);
  const bytesRead = buffer.copy(scratch, 0, 0, 100);
  if (bytesRead < 100) return false;

  let offset = skipID3(scratch);
  const bitRates = new Set<number>();

  let framesChecked = 0;

  while (offset < buffer.length && framesChecked < maxFramesToCheck) {
    const bytesRead = buffer.copy(scratch, 0, offset, offset + 10);
    if (bytesRead < 10) break;

    if (scratch[0] === 0xff && (scratch[1] & 0xe0) === 0xe0) {
      const header = parseFrameHeader(scratch);
      if (header.frameSize && header.samples && header.bitRate) {
        bitRates.add(header.bitRate);
        offset += header.frameSize;
        framesChecked++;

        if (bitRates.size > 1) return true; // VBR detected
      } else {
        offset++;
      }
    } else if (scratch[0] === 0x54 && scratch[1] === 0x41 && scratch[2] === 0x47) {
      offset += 128;
    } else {
      offset++;
    }
  }

  return false; // no bitrate variation seen
}

function skipID3(buffer: Buffer): number {
  // http://id3.org/d3v2.3.0
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    // ID3
    const id3v2Flags = buffer[5];
    const footerSize = id3v2Flags & 0x10 ? 10 : 0;

    // ID3 size encoding is crazy (7 bits in each of 4 bytes)
    const z0 = buffer[6];
    const z1 = buffer[7];
    const z2 = buffer[8];
    const z3 = buffer[9];

    if ((z0 & 0x80) === 0 && (z1 & 0x80) === 0 && (z2 & 0x80) === 0 && (z3 & 0x80) === 0) {
      const tagSize = (z0 & 0x7f) * 2097152 + (z1 & 0x7f) * 16384 + (z2 & 0x7f) * 128 + (z3 & 0x7f);
      return 10 + tagSize + footerSize;
    }
  }

  return 0;
}

function frameSize(
  samples: number,
  layer: number | string,
  bitRate: number,
  sampleRate: number,
  paddingBit: number,
): number {
  if (layer === 1) {
    return ((samples * bitRate * 125) / sampleRate + paddingBit * 4) | 0;
  } else {
    // layer 2, 3
    return ((samples * bitRate * 125) / sampleRate + paddingBit) | 0;
  }
}

function parseFrameHeader(header: Buffer) {
  const b1 = header[1];
  const b2 = header[2];

  const versionBits = (b1 & 0x18) >> 3;
  const version = versions[versionBits];
  const simpleVersion = version === '2.5' ? 2 : version;

  const layerBits = (b1 & 0x06) >> 1;
  const layer = layers[layerBits];

  const bitRateKey = 'V' + simpleVersion + 'L' + layer;
  const bitRateIndex = (b2 & 0xf0) >> 4;
  const bitRate = bitRates[bitRateKey][bitRateIndex] || 0;

  const sampleRateIdx = (b2 & 0x0c) >> 2;
  const sampleRate = sampleRates[version][sampleRateIdx] || 0;

  const sample = samples[simpleVersion][layer];

  const paddingBit = (b2 & 0x02) >> 1;

  return {
    bitRate: bitRate,
    sampleRate: sampleRate,
    frameSize: frameSize(sample, layer, bitRate, sampleRate, paddingBit),
    samples: sample,
  };
}
