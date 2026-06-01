import {
  formatCost,
  formatEnergyKwh,
  formatEnergyWh,
  formatPower,
  formatSessionName,
  isOverloadSession,
  normalizeSessionMap,
  numberOrZero,
  numberValue,
  sessionEnergyKwh,
  sessionEnergyWh
} from './utils.js';

const DEFAULT_WARNING_PERCENT = 90;

export function normalizeCompletedSessions(value){
  return normalizeSessionMap(value);
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
    const energyKwh = sessionEnergyKwh(session);
    const energyWh = sessionEnergyWh(session);
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
      insights.peakWarningText = 'Highest peak power is near the overload warning limit.';
    }
  }

  if(insights.overloadCount > 0){
    insights.overloadWarningText = 'Overload sessions found. Review the highest power loads.';
  }

  return insights;
}

export function renderInsightElements(elements, insights, currency = 'IDR'){
  setText(elements.totalSessions, `${insights.totalSessions} sessions`);
  setText(elements.totalEnergyKwh, formatEnergyKwh(insights.totalEnergyKwh, 6));
  setText(elements.totalEnergyWh, formatEnergyWh(insights.totalEnergyWh, 3));
  setText(elements.totalCost, formatCost(insights.totalCost, currency, null, currency === 'IDR' ? 'Rp 0' : '$0.00'));
  setText(elements.highestPeakPower, formatPower(insights.highestPeakPower));
  setText(elements.highestPeakPowerDevice, insights.highestPeakPowerDevice ?? '-');
  setText(elements.mostEnergyDevice, insights.mostEnergyDevice ?? '-');
  setText(
    elements.mostEnergyValue,
    insights.mostEnergyDevice
      ? `${formatEnergyKwh(insights.mostEnergyKwh, 6)} / ${formatEnergyWh(insights.mostEnergyWh, 3)}`
      : '-'
  );
  setText(elements.overloadCount, `${insights.overloadCount} sessions`);
  setWarning(elements.peakWarning, insights.peakWarningText);
  setWarning(elements.overloadWarning, insights.overloadWarningText);
}

export {
  formatCost,
  formatEnergyKwh,
  formatEnergyWh,
  formatPower,
  formatSessionName,
  isOverloadSession,
  sessionEnergyKwh as energyKwhValue,
  sessionEnergyWh as energyWhValue
};

function peakPowerValue(session){
  return numberValue(session.peakPower ?? session.power ?? session.averagePower);
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
