// FastPress Nav Menu Interactive Runtime
(function() {
  function initNavMenus() {
    const currentPath = window.location.pathname.replace(/\/$/, '') || '/';

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

      // 3. Highlight active links
      const links = widget.querySelectorAll('.nm-link');
      let exactMatched = false;
      links.forEach(link => {
        const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/';
        link.classList.remove('is-active');
        if (link.closest('.nm-item')) {
          link.closest('.nm-item').classList.remove('is-active');
        }

        if (href === currentPath) {
          exactMatched = true;
          link.classList.add('is-active');
          if (link.closest('.nm-item')) {
            link.closest('.nm-item').classList.add('is-active');
          }
        }
      });

      // Fallback: startsWith match for subroutes like /products/table-1
      if (!exactMatched && currentPath !== '/') {
        links.forEach(link => {
          const href = (link.getAttribute('href') || '').replace(/\/$/, '') || '/';
          if (href !== '/' && currentPath.startsWith(href)) {
            link.classList.add('is-active');
            if (link.closest('.nm-item')) {
              link.closest('.nm-item').classList.add('is-active');
            }
          }
        });
      }
    });

    // Close mobile dropdowns when clicking outside
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavMenus);
  } else {
    initNavMenus();
  }
  window.addEventListener('popstate', initNavMenus);
  window.__FP_INIT_NAV_MENUS__ = initNavMenus;
})();
