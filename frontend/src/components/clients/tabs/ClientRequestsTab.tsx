import React from 'react';
import { InformationRequestsSection } from '../../banking/InformationRequestsSection';

export const ClientRequestsTab: React.FC = () => {
  return (
    <div className="animate-in fade-in duration-200">
      <InformationRequestsSection />
    </div>
  );
};
