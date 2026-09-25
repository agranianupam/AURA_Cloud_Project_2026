export const generateMockData = () => {
  const energyMetrics = [];
  let baseEnergy = 200;
  const now = new Date();
  
  for(let i=0; i < 24*7; i++) {
    const timestamp = new Date(now.getTime() - (24*7 - i) * 60 * 60 * 1000).toISOString();
    const hour = new Date(timestamp).getHours();
    
    // Day/Night cycle
    const isDay = hour >= 8 && hour <= 18;
    const load = isDay ? 1.5 + Math.random() * 0.5 : 0.8 + Math.random() * 0.3;
    
    const baselineEnergyKwh = baseEnergy * load;
    const energyKwh = baselineEnergyKwh * (0.8 - Math.random() * 0.1);
    
    const carbonIntensity = isDay ? 300 : 150;
    
    energyMetrics.push({
      timestamp,
      utilization: load * 40,
      cost: energyKwh * 0.12,
      predicted: baselineEnergyKwh,
      energyKwh,
      carbonIntensity,
      carbonGco2: energyKwh * carbonIntensity,
      baselineEnergyKwh,
      baselineCarbonGco2: baselineEnergyKwh * carbonIntensity
    });
  }

  const savings = {
    energySavedKwh: 12540.2,
    carbonSavedKg: 4250.5,
    costSaved: 1504.8,
    percentReduction: 22.4,
    slaCompliancePct: 99.98
  };

  const allocations = [
    { resourceId: 'i-0abcd12345efgh2', service: 'Amazon EC2', status: 'Running', capacity: 't3.large' },
    { resourceId: 'i-0xyza98765ijkl3', service: 'Amazon EC2', status: 'Stopped', capacity: 'c5.xlarge' },
    { resourceId: 'lambda-lms-processor', service: 'AWS Lambda', status: 'Active', capacity: '1024 MB' },
    { resourceId: 'sagemaker-ep-01', service: 'Amazon SageMaker', status: 'Running', capacity: 'ml.m5.large' }
  ];

  const alerts = [
    { timestamp: new Date(now.getTime() - 1000 * 60 * 15).toISOString(), type: 'scaling', message: 'Scaled down EC2 fleet due to projected low demand', severity: 'info' },
    { timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(), type: 'carbon', message: 'Shifted heavy batch processing to 2:00 AM window targeting low carbon intensity', severity: 'warning' },
    { timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString(), type: 'scaling', message: 'Unexpected traffic spike detected on LMS. Pre-scaling nodes.', severity: 'critical' },
    { timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 26).toISOString(), type: 'carbon', message: 'Region carbon intensity above SLA threshold. Alerting grid manager.', severity: 'warning' }
  ];

  return { energyMetrics, savings, allocations, alerts };
}
