import type { ActiveTab, WorkspaceSubTab } from '../context/AutomationContext';

export interface RouteState {
  tab: ActiveTab;
  subTab?: WorkspaceSubTab;
  path: string;
}

// Canonical path mappings
export const ROUTE_MAP: Array<{
  path: string;
  tab: ActiveTab;
  subTab?: WorkspaceSubTab;
  aliases?: string[];
}> = [
  // Watched Accounts / Information Requests (Top Priority)
  {
    path: '/requests',
    tab: 'workspace',
    subTab: 'requests',
    aliases: ['/workspace/requests', '/information-requests', '/clarifications'],
  },
  // Client Workspace Sub-tabs
  {
    path: '/overview',
    tab: 'workspace',
    subTab: 'overview',
    aliases: ['/workspace', '/workspace/overview', '/dashboard'],
  },
  {
    path: '/ar',
    tab: 'workspace',
    subTab: 'ar',
    aliases: ['/workspace/ar', '/revenue', '/slips'],
  },
  {
    path: '/ap',
    tab: 'workspace',
    subTab: 'ap',
    aliases: ['/workspace/ap', '/bills', '/vendor-bills'],
  },
  {
    path: '/bank',
    tab: 'workspace',
    subTab: 'bank',
    aliases: ['/workspace/bank', '/statements'],
  },
  {
    path: '/pipelines',
    tab: 'workspace',
    subTab: 'pipelines',
    aliases: ['/workspace/pipelines', '/streams'],
  },
  {
    path: '/settings',
    tab: 'workspace',
    subTab: 'settings',
    aliases: ['/workspace/settings', '/company-settings'],
  },

  // Accounting Suite & Platform Sections
  {
    path: '/contacts',
    tab: 'contacts',
    aliases: ['/team', '/stakeholders'],
  },
  {
    path: '/catalog',
    tab: 'catalog',
    aliases: ['/items', '/services'],
  },
  {
    path: '/whats-new',
    tab: 'changelog',
    aliases: ['/changelog', '/updates'],
  },
  {
    path: '/broadcaster',
    tab: 'social',
    aliases: ['/social', '/release-broadcaster'],
  },
  {
    path: '/landing-manager',
    tab: 'landing-manager',
    aliases: ['/landing-page', '/visitor-settings', '/landing'],
  },
  {
    path: '/billing',
    tab: 'billing',
    aliases: ['/subscriptions', '/payments', '/cost-monitor'],
  },
  {
    path: '/platform-settings',
    tab: 'config',
    aliases: ['/config', '/system-settings'],
  },
  {
    path: '/logs',
    tab: 'logs',
    aliases: ['/telemetry', '/console'],
  },

  // Public & External Views
  {
    path: '/portal',
    tab: 'portal',
    aliases: ['/client-portal'],
  },
  {
    path: '/privacy',
    tab: 'privacy',
    aliases: ['/privacy-policy'],
  },
];

/**
 * Parses the current browser URL (pathname + hash + search) into canonical RouteState.
 * Automatically handles and cleans up stale hashes like #roi-calculator.
 */
export function parseCurrentRoute(): RouteState {
  if (typeof window === 'undefined') {
    return { tab: 'workspace', subTab: 'requests', path: '/requests' };
  }

  const pathname = (window.location.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  const rawHash = (window.location.hash || '').toLowerCase().replace(/^#\/?/, '');
  const search = window.location.search || '';

  // 1. Check if hash matches a known route or alias
  if (rawHash) {
    // If it's a known non-route hash like "roi-calculator" or "features", ignore and clean it
    const nonRouteHashes = ['roi-calculator', 'features', 'pricing', 'faq', 'testimonials', 'hero', 'demo'];
    if (nonRouteHashes.includes(rawHash)) {
      // Return default requests route and trigger silent hash removal
      return { tab: 'workspace', subTab: 'requests', path: '/requests' };
    }

    const hashAsPath = `/${rawHash}`;
    const hashMatch = ROUTE_MAP.find(
      (r) => r.path === hashAsPath || (r.aliases && r.aliases.includes(hashAsPath))
    );
    if (hashMatch) {
      return { tab: hashMatch.tab, subTab: hashMatch.subTab, path: hashMatch.path };
    }
  }

  // 2. Match standard pathname
  const exactMatch = ROUTE_MAP.find(
    (r) => r.path === pathname || (r.aliases && r.aliases.includes(pathname))
  );
  if (exactMatch) {
    return { tab: exactMatch.tab, subTab: exactMatch.subTab, path: exactMatch.path };
  }

  // 3. Fallbacks for query parameters
  if (search.includes('tab=privacy') || pathname.includes('privacy')) {
    return { tab: 'privacy', path: '/privacy' };
  }
  if (search.includes('tab=portal') || pathname.includes('portal')) {
    return { tab: 'portal', path: '/portal' };
  }

  // 4. Default landing or workspace
  if (pathname === '/' || pathname === '') {
    return { tab: 'workspace', subTab: 'requests', path: '/requests' };
  }

  // Default fallback to Information Requests
  return { tab: 'workspace', subTab: 'requests', path: '/requests' };
}

/**
 * Generates the canonical URL for a given tab and workspace sub-tab.
 */
export function getCanonicalPath(tab: ActiveTab, subTab?: WorkspaceSubTab): string {
  if (tab === 'workspace') {
    const match = ROUTE_MAP.find((r) => r.tab === 'workspace' && r.subTab === (subTab || 'requests'));
    return match ? match.path : '/requests';
  }

  const match = ROUTE_MAP.find((r) => r.tab === tab);
  return match ? match.path : `/${tab}`;
}

/**
 * Synchronizes the browser address bar with the active view.
 * Uses window.history.pushState or replaceState.
 */
export function syncUrlWithRoute(tab: ActiveTab, subTab?: WorkspaceSubTab, replace: boolean = false): void {
  if (typeof window === 'undefined') return;

  const targetPath = getCanonicalPath(tab, subTab);
  const currentPath = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const currentHash = window.location.hash;

  // Preserve query parameters (e.g. ?token=... for portal or filters)
  const search = window.location.search || '';
  const newUrl = `${targetPath}${search}`;

  // Only update if path changed or if there is a lingering dirty hash (like #roi-calculator)
  if (currentPath !== targetPath || currentHash) {
    try {
      if (replace || currentHash.includes('roi-calculator')) {
        window.history.replaceState({ tab, subTab }, '', newUrl);
      } else {
        window.history.pushState({ tab, subTab }, '', newUrl);
      }
    } catch (e) {
      console.warn('Could not update browser history:', e);
    }
  }
}

/**
 * Subscribes to browser back/forward buttons (popstate events).
 */
export function initRouteListener(onRouteChanged: (route: RouteState) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handlePopState = () => {
    const route = parseCurrentRoute();
    onRouteChanged(route);
  };

  window.addEventListener('popstate', handlePopState);
  return () => {
    window.removeEventListener('popstate', handlePopState);
  };
}
