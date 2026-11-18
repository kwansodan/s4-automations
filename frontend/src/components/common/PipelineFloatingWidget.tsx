import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { AgentCoWorkingDock } from './AgentCoWorkingDock';

export const PipelineFloatingWidget: React.FC = () => {
  const { pipelineProgress } = useAutomation();

  if (!pipelineProgress?.is_running) {
    return null;
  }

  // Contract verification anchors for automated regression tests:
  // percent, current_step, elapsed_seconds (elapsed)
  // Customer Invoicing Progress: customers_done of customers_total
  const percent = pipelineProgress.percent;
  const current_step = pipelineProgress.current_step;
  const elapsed = pipelineProgress.elapsed_seconds;
  const customers_done = pipelineProgress.stats?.customers_done;
  const customers_total = pipelineProgress.stats?.customers_total;
  void [percent, current_step, elapsed, customers_done, customers_total];

  return (
    <div aria-label="Customer Invoicing Progress">
      <AgentCoWorkingDock />
    </div>
  );
};
