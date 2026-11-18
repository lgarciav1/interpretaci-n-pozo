import { useEffect, useMemo, useState } from 'react';
import type { ClientResult } from '../../core/engine/client';
import type { ParamState } from '../../core/params';
import { BAND_ROLES, type BandRole, type CurveBandRequest, type CurveBands } from '../../petro/curveBands';
import type { ResolvedCurve, ResolvedTrack } from '../../viewer/resolve';
import { bandSettings } from './settings';
import { SETTLE_MS } from '../useSettled';
import CurveBandsWorker from './curveBands.worker?worker&inline';

export const BAND_LABELS: Record<BandRole, string> = { PHIE: 'φ', SW: 'Sw' };

export function bandCurve(track: ResolvedTrack, role: BandRole, result: ClientResult | null): ResolvedCurve | undefined {
  const source = result?.sources[role];
  if (track.kind !== 'curves' || !source) return undefined;
  return track.curves.find(c => c.kind === 'line' && c.role === role && c.unit === 'v/v' &&
    (source.kind === 'module' ? c.moduleId === source.moduleId : c.curveId === source.curveId));
}

function bandValues(tracks: readonly ResolvedTrack[], role: BandRole, result: ClientResult | null): Float64Array | undefined {
  for (const track of tracks) {
    const curve = bandCurve(track, role, result);
    if (curve) return curve.data;
  }
  return undefined;
}

type BandReply = { request: CurveBandRequest; bands: CurveBands | null };

export function useCurveBands(tracks: readonly ResolvedTrack[], result: ClientResult | null, params: ParamState | undefined) {
  const phi = bandValues(tracks, 'PHIE', result);
  const sw = bandValues(tracks, 'SW', result);
  const settings = useMemo(() => params && bandSettings(params), [params]);
  const { distribution, phiLow, phiHigh, swLow, swHigh } = settings ?? {};
  const request = useMemo<CurveBandRequest | null>(() => {
    if (!distribution || (!phi && !sw)) return null;
    return {
      ...(phi && phiLow !== undefined && phiHigh !== undefined
        ? { PHIE: { values: phi, multiplier: { kind: distribution, min: phiLow, mode: 1, max: phiHigh } } } : {}),
      ...(sw && swLow !== undefined && swHigh !== undefined
        ? { SW: { values: sw, multiplier: { kind: distribution, min: swLow, mode: 1, max: swHigh } } } : {}),
    };
  }, [phi, sw, distribution, phiLow, phiHigh, swLow, swHigh]);
  const [reply, setReply] = useState<BandReply | null>(null);

  useEffect(() => {
    if (!request) return;
    let running = true;
    let worker: Worker | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (bands: CurveBands | null) => {
      if (!running) return;
      running = false;
      clearTimeout(deadline);
      worker?.terminate();
      setReply({ request, bands });
    };
    const start = setTimeout(() => {
      try {
        worker = new CurveBandsWorker({ name: 'bandas-de-incertidumbre' });
        worker.onmessage = (event: MessageEvent<CurveBands>) => finish(event.data);
        worker.onerror = worker.onmessageerror = () => finish(null);
        deadline = setTimeout(() => finish(null), 15000);
        // Clonar las entradas. Pertenecen a las curvas del visor y al resultado del motor.
        worker.postMessage(request);
      } catch {
        finish(null);
      }
    }, SETTLE_MS);
    return () => {
      running = false;
      clearTimeout(start);
      clearTimeout(deadline);
      worker?.terminate();
    };
  }, [request]);

  const current = reply?.request === request ? reply : null;
  return { bands: current?.bands ?? null, pending: !!request && !current, failed: !!current && !current.bands };
}

export function withCurveBands(track: ResolvedTrack, result: ClientResult | null, bands: CurveBands, visible: (role: BandRole) => boolean): ResolvedTrack {
  const fills = [...track.fills];
  for (const role of BAND_ROLES) {
    const band = bands[role];
    if (!band || !visible(role)) continue;
    const curve = bandCurve(track, role, result);
    if (!curve) continue;
    fills.push({
      kind: 'between',
      a: { ...curve, key: `uncertainty:p90:${role}:${curve.key}`, data: band.p90 },
      b: { ...curve, key: `uncertainty:p10:${role}:${curve.key}`, data: band.p10 },
      aLeft: 'curveUncertainty',
      bLeft: 'curveUncertainty',
      compare: 'screen',
      opacity: 1,
    });
  }
  return fills.length === track.fills.length ? track : { ...track, fills };
}
