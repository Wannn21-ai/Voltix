const DEFAULT_WARNING_PERCENT = 90;

export function normalizeCompletedSessions(value){
  if(value === null || value === undefined) return [];

  return Object.entries(value)
    .map(([key, session])=>({
      ...(session ?? {}),
      id: session?.id ?? key,
      sessionId: session?.sessionId ?? key
    }))
    .sort((a, b)=>timestampForSort(b) - timestampForSort(a));
}

export function computeEnergyInsights(sessions, config = {}){
  const list = Array.isArray(sessions) ? sessions : [];
  const configThreshold = numberValue(config?.overloadThreshold);
  const warningPercent = clampPercent(config?.overloadWarningPercent) ?? DEFAULT_WARNING_PERCENT;

  const insights = {
    totalSessions: list.length,
    totalEnergyKwh: 0,
    totalEnergyWh: 0,
    totalCost: 0,
    highestPeakPower: null,
    highestPeakPowerDevice: null,
    highestPeakPowerThreshold: null,
    mostEnergyDevice: null,
    mostEnergyKwh: null,
    mostEnergyWh: null,
    overloadCount: 0,
    peakWarningText: '',
    overloadWarningText: ''
  };

  list.forEach(session=>{
    const energyKwh = energyKwhValue(session);
    const energyWh = energyWhValue(session);
    const cost = numberValue(session.cost);
    const peakPower = peakPowerValue(session);

    insights.totalEnergyKwh += numberOrZero(energyKwh);
    insights.totalEnergyWh += numberOrZero(energyWh);
    insights.totalCost += numberOrZero(cost);

    if(peakPower !== null && (insights.highestPeakPower === null || peakPower > insights.highestPeakPower)){
      insights.highestPeakPower = peakPower;
      insights.highestPeakPowerDevice = formatSessionName(session.name ?? session.deviceName);
      insights.highestPeakPowerThreshold = configThreshold ?? numberValue(session.overloadThreshold);
    }

    if(energyKwh !== null && (insights.mostEnergyKwh === null || energyKwh > insights.mostEnergyKwh)){
      insights.mostEnergyKwh = energyKwh;
      insights.mostEnergyWh = energyWh;
      insights.mostEnergyDevice = formatSessionName(session.name ?? session.deviceName);
    }

    if(isOverloadSession(session)){
      insights.overloadCount += 1;
    }
  });

  const threshold = insights.highestPeakPowerThreshold;
  if(insights.highestPeakPower !== null && threshold !== null && threshold > 0){
    const warningLimit = threshold * (warningPercent / 100);
    if(insights.highestPeakPower >= warningLimit){
      insights.peakWarningText = 'Beban ini mendekati batas overload.';
    }
  }

  if(insights.overloadCount > 0){
    insights.overloadWarningText = 'Ada sesi overload. Cek beban dengan daya tertinggi.';
  }

  return insights;
}

export function renderInsightElements(elements, insights){
  setText(elements.totalSessions, `${insights.totalSessions} sessions`);
  setText(elements.totalEnergyKwh, formatEnergyKwh(insights.totalEnergyKwh));
  setText(elements.totalEnergyWh, formatEnergyWh(insights.totalEnergyWh));
  setText(elements.totalCost, formatCost(insights.totalCost, null, 'Rp 0'));
  setText(elements.highestPeakPower, formatPower(insights.highestPeakPower));
  setText(elements.highestPeakPowerDevice, insights.highestPeakPowerDevice ?? '-');
  setText(elements.mostEnergyDevice, insights.mostEnergyDevice ?? '-');
  setText(elements.mostEnergyValue, insights.mostEnergyDevice ? `${formatEnergyKwh(insights.mostEnergyKwh)} / ${formatEnergyWh(insights.mostEnergyWh)}` : '-');
  setText(elements.overloadCount, `${insights.overloadCount} sessions`);
  setWarning(elements.peakWarning, insights.peakWarningText);
  setWarning(elements.overloadWarning, insights.overloadWarningText);
}

export function energyKwhValue(session){
  const energy = numberValue(session.energy);
  if(energy !== null) return energy;

  const energyWh = numberValue(session.energyWh);
  return energyWh === null ? null : energyWh / 1000;
}

export function energyWhValue(session){
  const energyWh = numberValue(session.energyWh);
  if(energyWh !== null) return energyWh;

  const energy = numberValue(session.energy);
  return energy === null ? null : energy * 1000;
}

export function formatEnergyKwh(value){
  const formatted = formatNumber(value, 6);
  return formatted === '-' ? '-' : `${formatted} kWh`;
}

export function formatEnergyWh(value){
  const formatted = formatNumber(value, 3);
  return formatted === '-' ? '-' : `${formatted} Wh`;
}

export function formatCost(value, costText, emptyText = '-'){
  const number = numberValue(value);
  if(number !== null && number > 0 && number < 1) return '< Rp 1';
  if(number !== null) return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
  if(costText !== null && costText !== undefined && costText !== '') return String(costText);
  return emptyText;
}

export function formatPower(value){
  const formatted = formatNumber(value, 1);
  return formatted === '-' ? '-' : `${formatted} W`;
}

export function formatSessionName(name){
  if(name === null || name === undefined) return 'Beban Tanpa Nama';
  const text = String(name).trim();
  if(text === '' || text.toLowerCase() === 'unnamed load') return 'Beban Tanpa Nama';
  return text;
}

export function isOverloadSession(session){
  const reason = String(session?.endReason ?? session?.reason ?? '').trim().toUpperCase();
  return reason === 'OVERLOAD' || session?.overload === true || session?.isOverload === true;
}

export function numberValue(value){
  if(value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

export function numberOrZero(value){
  const number = numberValue(value);
  return number === null ? 0 : number;
}

function peakPowerValue(session){
  return numberValue(session.peakPower ?? session.power ?? session.averagePower);
}

function timestampForSort(session){
  const value = numberValue(session.timestamp);
  return value === null ? Number.NEGATIVE_INFINITY : value;
}

function formatNumber(value, decimals){
  if(value === null || value === undefined) return '-';
  const number = Number(value);
  if(Number.isNaN(number)) return '-';
  return number.toFixed(decimals);
}

function clampPercent(value){
  const number = numberValue(value);
  if(number === null) return null;
  return Math.min(100, Math.max(1, number));
}

function setText(element, value){
  if(element) element.textContent = value;
}

function setWarning(element, text){
  if(!element) return;
  element.textContent = text;
  element.hidden = text === '';
}
