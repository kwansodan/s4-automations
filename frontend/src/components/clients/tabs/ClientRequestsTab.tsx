import React from 'react';
import { InformationRequestsControlCenter } from '../../requests/InformationRequestsControlCenter';

export const ClientRequestsTab: React.FC = () => {
  return (
    <div className="animate-in fade-in duration-200">
      <InformationRequestsControlCenter />
    </div>
  );
};

