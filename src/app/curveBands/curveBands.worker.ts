import { BAND_ROLES, curveBand, type CurveBandRequest, type CurveBands } from '../../petro/curveBands';

self.onmessage = ({ data }: MessageEvent<CurveBandRequest>) => {
  const bands: CurveBands = {};
  const transfer: Transferable[] = [];
  for (const role of BAND_ROLES) {
    const input = data[role];
    if (!input) continue;
    const band = curveBand(input);
    bands[role] = band;
    transfer.push(band.p90.buffer, band.p10.buffer);
  }
  self.postMessage(bands, { transfer });
};
