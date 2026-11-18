import React from 'react';
import { useAutomation } from '../../context/AutomationContext';
import { AgentCoWorkingDock } from './AgentCoWorkingDock';

export const PipelineFloatingWidget: React.FC = () => {
  const { pipelineProgress } = useAutomation();

  if (!pipelineProgress?.is_running) {
    return null;
  }

  return <AgentCoWorkingDock />;
};
