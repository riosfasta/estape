// FastPress Nav Menu Interactive Runtime
(function() {
  const SLUG_PATH_ALIASES = {
    'tentang-kami': '/about',
    'about-us': '/about',
    'produk': '/products',
    'shop': '/products',
    'kontak': '/contact',
    'contact-us': '/contact',
    'home': '/',
    'index': '/',
  };

  function resolveActiveTarget(overrideSlug) {
    if (typeof overrideSlug === 'string' && overrideSlug.trim()) {
      const slug = overrideSlug.trim().replace(/^\/+|\/+$/g, '');
      const path = slug === 'home' || slug === 'index' ? '/' : ('/' + slug);
      return { path, alias: SLUG_PATH_ALIASES[slug] || '' };
    }
    const rawPath = window.location.pathname.replace(/\/+$/, '') || '/';
    if (rawPath === '/editor') {
      const params = new URLSearchParams(window.location.search);
      const slug = (params.get('slug') || (typeof window.currentSlug === 'string' ? window.currentSlug : '')).trim().replace(/^\/+|\/+$/g, '');
      if (slug) {
        const path = slug === 'home' || slug === 'index' ? '/' : ('/' + slug);
        return { path, alias: SLUG_PATH_ALIASES[slug] || '' };
      }
    }
    const pathSlug = rawPath.replace(/^\/+/, '');
    return { path: rawPath, alias: SLUG_PATH_ALIASES[pathSlug] || '' };
  }

  function normalizeLinkPath(hrefAttr) {
    const raw = (hrefAttr || '').trim();
    if (!raw || raw === '#' || /^(?:javascript|mailto|tel):/i.test(raw)) return null;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw, window.location.origin);
        if (parsed.origin !== window.location.origin) return null;
        return parsed.pathname.replace(/\/+$/, '') || '/';
      } catch {
        return null;
      }
    }
    const clean = raw.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
    return clean.startsWith('/') ? clean : ('/' + clean);
  }

  function highlightActiveLinks(links, target, syncItemParent) {
    if (!links || !links.length) return;
    const currentPath = target.path;
    const aliasPath = target.alias || '';
    const matches = [];
    let hasExact = false;
    let hasAlias = false;
    let bestPrefixLen = 0;

    links.forEach((link) => {
      link.classList.remove('is-active');
      link.removeAttribute('aria-current');
      if (link.style && link.style.borderBottom) link.style.borderBottom = '';
      if (syncItemParent && link.closest('.nm-item')) {
        link.closest('.nm-item').classList.remove('is-active');
      }

      const href = normalizeLinkPath(link.getAttribute('href'));
      if (!href) return;

      const isExact = href === currentPath;
      const isAlias = !isExact && Boolean(aliasPath && href === aliasPath);
      const prefixLen = !isExact && !isAlias && currentPath !== '/' && href !== '/' && currentPath.startsWith(href + '/')
        ? href.length
        : 0;
      if (isExact) hasExact = true;
      if (isAlias) hasAlias = true;
      if (prefixLen > bestPrefixLen) bestPrefixLen = prefixLen;
      matches.push({ link, isExact, isAlias, prefixLen });
    });

    matches.forEach(({ link, isExact, isAlias, prefixLen }) => {
      const active = hasExact
        ? isExact
        : hasAlias
          ? isAlias
          : (bestPrefixLen > 0 && prefixLen === bestPrefixLen);
      if (!active) return;
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
      if (syncItemParent && link.closest('.nm-item')) {
        link.closest('.nm-item').classList.add('is-active');
      }
    });
  }

  function initNavMenus(overrideSlug) {
    const target = resolveActiveTarget(overrideSlug);

    document.querySelectorAll('.fp-nav-menu-widget').forEach(widget => {
      // 1. Mobile toggle click handler
      const toggleBtn = widget.querySelector('.nm-mobile-toggle');
      if (toggleBtn && !toggleBtn.__nm_bound) {
        toggleBtn.__nm_bound = true;
        toggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isOpen = widget.classList.toggle('is-mobile-open');
          toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });
      }

      // 2. Submenu click handling on mobile / touch
      widget.querySelectorAll('.nm-has-children > .nm-link').forEach(link => {
        if (!link.__nm_touch_bound) {
          link.__nm_touch_bound = true;
          link.addEventListener('click', (e) => {
            const isMobile = window.innerWidth <= 1024;
            if (isMobile) {
              const item = link.closest('.nm-has-children');
              if (item && !item.classList.contains('is-open')) {
                e.preventDefault();
                item.classList.add('is-open');
              }
            }
          });
        }
      });

      // 3. Highlight active links inside widget
      highlightActiveLinks(widget.querySelectorAll('.nm-link'), target, true);
    });

    // 4. Highlight active links across template/theme headers & pop drawers
    highlightActiveLinks(
      document.querySelectorAll('.block-furnisite-navbar .bfn-nav a, .block-furnisite-navbar .bfn-nav-link, .furnisite-nav-list a, .furnisite-nav-link, .header-nav-list .nav-root-link'),
      target,
      false
    );
    highlightActiveLinks(
      document.querySelectorAll('.pop-drawer-link, .furnisite-drawer-link'),
      target,
      false
    );

    // Close mobile dropdowns when clicking outside (bind once)
    if (!window.__FP_NM_DOC_BOUND__) {
      window.__FP_NM_DOC_BOUND__ = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.fp-nav-menu-widget')) {
          document.querySelectorAll('.fp-nav-menu-widget.is-mobile-open').forEach(w => {
            w.classList.remove('is-mobile-open');
            const btn = w.querySelector('.nm-mobile-toggle');
            if (btn) btn.setAttribute('aria-expanded', 'false');
          });
        }
      });
    }
  }

  if (!window.__FP_POP_DRAWER_BOUND__) {
    window.__FP_POP_DRAWER_BOUND__ = true;

    const closeAllPopDrawers = () => {
      document.querySelectorAll('.pop-drawer-overlay.is-open, .pop-drawer-overlay[data-open="true"]').forEach((overlay) => {
        overlay.classList.remove('is-open');
        overlay.removeAttribute('data-open');
      });
      document.body.style.overflow = '';
    };

    document.addEventListener('click', (e) => {
      if (e.__fpPopDrawerHandled) return;
      const trigger = e.target.closest('.pop-drawer-trigger-btn, [data-pop-drawer-trigger]');
      if (trigger) {
        e.__fpPopDrawerHandled = true;
        e.preventDefault();
        e.stopPropagation();
        const root = trigger.closest('.pop-drawer-component') || trigger.closest('header') || document;
        const overlay = root.querySelector('.pop-drawer-overlay') || document.querySelector('.pop-drawer-overlay');
        if (overlay) {
          const willOpen = !(overlay.classList.contains('is-open') || overlay.getAttribute('data-open') === 'true');
          closeAllPopDrawers();
          if (willOpen) {
            overlay.classList.add('is-open');
            overlay.setAttribute('data-open', 'true');
            document.body.style.overflow = 'hidden';
          }
        }
        return;
      }

      const closeBtn = e.target.closest('.pop-drawer-close-btn');
      const backdrop = e.target.closest('.pop-drawer-backdrop');
      if (closeBtn || backdrop) {
        e.__fpPopDrawerHandled = true;
        e.preventDefault();
        const overlay = (closeBtn || backdrop).closest('.pop-drawer-overlay') || document.querySelector('.pop-drawer-overlay');
        if (overlay) {
          overlay.classList.remove('is-open');
          overlay.removeAttribute('data-open');
          document.body.style.overflow = '';
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllPopDrawers();
      }
    });

    document.addEventListener('input', (e) => {
      const searchInput = e.target.closest('.pop-drawer-search-input');
      if (!searchInput) return;
      const panel = searchInput.closest('.pop-drawer-panel');
      if (!panel) return;
      const q = (searchInput.value || '').trim().toLowerCase();
      panel.querySelectorAll('.pop-drawer-menu li').forEach((li) => {
        const text = (li.textContent || '').toLowerCase();
        li.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavMenus);
  } else {
    initNavMenus();
  }
  window.addEventListener('popstate', initNavMenus);
  window.__FP_INIT_NAV_MENUS__ = initNavMenus;
})();
