// =====================================================================
// tcx.js — Exportación .TCX (respaldo del .FIT). La potencia va en la
// extensión <ns3:Watts> de Garmin (ActivityExtension v2).
// =====================================================================

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function encodeTcx(s) {
  const S = s.samples;
  const n = S.p.length;
  const sum = s.summary || {};
  const dist = n ? S.d[n - 1] : 0;
  const maxSpeedMs = (sum.maxSpeed || 0) / 3.6;
  const avgSpeedMs = n ? dist / n : 0;

  const pts = [];
  for (let i = 0; i < n; i++) {
    const cad = S.c[i] == null ? '' : `\n            <Cadence>${Math.round(S.c[i])}</Cadence>`;
    pts.push(`          <Trackpoint>
            <Time>${iso(S.ts[i])}</Time>
            <DistanceMeters>${S.d[i].toFixed(1)}</DistanceMeters>${cad}
            <Extensions>
              <ns3:TPX>
                <ns3:Speed>${(S.v[i] / 3.6).toFixed(3)}</ns3:Speed>
                <ns3:Watts>${Math.round(S.p[i])}</ns3:Watts>
              </ns3:TPX>
            </Extensions>
          </Trackpoint>`);
  }

  const avgCad = sum.avgCadence ? `\n        <Cadence>${sum.avgCadence}</Cadence>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Biking">
      <Id>${iso(s.startMs)}</Id>
      <Lap StartTime="${iso(s.startMs)}">
        <TotalTimeSeconds>${n}</TotalTimeSeconds>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <MaximumSpeed>${maxSpeedMs.toFixed(3)}</MaximumSpeed>
        <Calories>${Math.round(sum.kj || 0)}</Calories>
        <Intensity>Active</Intensity>${avgCad}
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${pts.join('\n')}
        </Track>
        <Extensions>
          <ns3:LX>
            <ns3:AvgSpeed>${avgSpeedMs.toFixed(3)}</ns3:AvgSpeed>
            <ns3:AvgWatts>${sum.avgPower || 0}</ns3:AvgWatts>
            <ns3:MaxWatts>${sum.maxPower || 0}</ns3:MaxWatts>
          </ns3:LX>
        </Extensions>
      </Lap>
      <Notes>${(s.name || 'Rodillo').replace(/[<&>]/g, '')} - potencia virtual CycleOps Fluid 2</Notes>
      <Creator xsi:type="Device_t">
        <Name>Potencia Virtual PWA</Name>
        <UnitId>0</UnitId>
        <ProductID>0</ProductID>
        <Version><VersionMajor>1</VersionMajor><VersionMinor>0</VersionMinor></Version>
      </Creator>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}
