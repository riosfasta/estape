// FastPress Products Loop Interactive Runtime
(function () {
  function initProductsLoopWidgets(rootDoc) {
    const doc = rootDoc || document;
    const widgets = doc.querySelectorAll('.fp-products-loop-widget');

    widgets.forEach((widget) => {
      widget.__fp_loop_initialized = true;

      const paginationType = widget.getAttribute('data-pagination-type') || 'load-more';
      const perPage = parseInt(widget.getAttribute('data-per-page') || '6', 10) || 6;
      const columns = parseInt(widget.getAttribute('data-columns') || '3', 10) || 3;
      const category = (widget.getAttribute('data-category') || 'all').toLowerCase().trim();
      const orderby = widget.getAttribute('data-orderby') || 'default';

      // Set CSS variable for columns
      widget.style.setProperty('--fp-grid-cols', columns);
      const grid = widget.querySelector('.fp-products-grid');
      if (grid) {
        grid.style.setProperty('--fp-grid-cols', columns);
      }

      // Collect product cards
      const allCards = Array.from(widget.querySelectorAll('.fp-product-card'));
      if (allCards.length === 0) return;

      // Filter cards by category if set
      let matchedCards = allCards;
      if (category && category !== 'all') {
        matchedCards = allCards.filter((card) => {
          const cardCat = (card.getAttribute('data-category') || '').toLowerCase();
          const cardCats = (card.getAttribute('data-categories') || '').toLowerCase();
          return cardCat.includes(category) || cardCats.includes(category);
        });
      }

      // Re-order cards if requested
      if (orderby === 'price-asc') {
        matchedCards.sort((a, b) => parseFloat(a.getAttribute('data-price') || '0') - parseFloat(b.getAttribute('data-price') || '0'));
      } else if (orderby === 'price-desc') {
        matchedCards.sort((a, b) => parseFloat(b.getAttribute('data-price') || '0') - parseFloat(a.getAttribute('data-price') || '0'));
      }

      // Hide unmatched cards
      allCards.forEach((c) => {
        if (!matchedCards.includes(c)) {
          c.style.display = 'none';
          c.setAttribute('hidden', '');
        }
      });

      const totalItems = matchedCards.length;
      let currentPage = 1;
      const totalPages = Math.ceil(totalItems / perPage) || 1;

      // Locate pagination elements
      const paginationContainer = widget.querySelector('.fp-products-pagination');
      const loadMoreWrap = widget.querySelector('.fp-pagination-load-more-wrap');
      const loadMoreBtn = widget.querySelector('.fp-load-more-btn');
      const countCurrentEl = widget.querySelector('.fp-count-current');
      const countTotalEl = widget.querySelector('.fp-count-total');

      const numbersWrap = widget.querySelector('.fp-pagination-numbers-wrap');
      const pageNumbersContainer = widget.querySelector('.fp-page-numbers');
      const prevBtn = widget.querySelector('.fp-prev-btn');
      const nextBtn = widget.querySelector('.fp-next-btn');

      if (countTotalEl) {
        countTotalEl.textContent = String(totalItems);
      }

      function updateLoadMoreView(visibleLimit) {
        matchedCards.forEach((card, idx) => {
          if (idx < visibleLimit) {
            card.style.display = '';
            card.removeAttribute('hidden');
          } else {
            card.style.display = 'none';
            card.setAttribute('hidden', '');
          }
        });

        const currentVisible = Math.min(visibleLimit, totalItems);
        if (countCurrentEl) {
          countCurrentEl.textContent = String(currentVisible);
        }

        if (loadMoreBtn) {
          const btnText = loadMoreBtn.querySelector('.fp-btn-text') || loadMoreBtn;
          if (currentVisible >= totalItems) {
            loadMoreBtn.disabled = true;
            btnText.textContent = 'All Products Loaded';
          } else {
            loadMoreBtn.disabled = false;
            btnText.textContent = 'Load More Products';
          }
        }
      }

      function updateNumbersView(page) {
        currentPage = page;
        const startIndex = (page - 1) * perPage;
        const endIndex = startIndex + perPage;

        matchedCards.forEach((card, idx) => {
          if (idx >= startIndex && idx < endIndex) {
            card.style.display = '';
            card.removeAttribute('hidden');
          } else {
            card.style.display = 'none';
            card.setAttribute('hidden', '');
          }
        });

        // Render page buttons
        if (pageNumbersContainer) {
          pageNumbersContainer.innerHTML = '';
          for (let p = 1; p <= totalPages; p++) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'fp-page-num' + (p === currentPage ? ' is-active' : '');
            btn.setAttribute('data-page', String(p));
            btn.textContent = String(p);
            btn.addEventListener('click', (e) => {
              e.preventDefault();
              updateNumbersView(p);
              try {
                widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } catch (err) {}
            });
            pageNumbersContainer.appendChild(btn);
          }
        }

        if (prevBtn) {
          prevBtn.disabled = currentPage <= 1;
        }
        if (nextBtn) {
          nextBtn.disabled = currentPage >= totalPages;
        }
      }

      // Configure layout based on paginationType
      if (paginationType === 'none') {
        if (paginationContainer) paginationContainer.style.display = 'none';
        matchedCards.forEach((card, idx) => {
          if (idx < perPage) {
            card.style.display = '';
            card.removeAttribute('hidden');
          } else {
            card.style.display = 'none';
            card.setAttribute('hidden', '');
          }
        });
      } else if (paginationType === 'load-more') {
        if (paginationContainer) paginationContainer.style.display = 'flex';
        if (loadMoreWrap) loadMoreWrap.style.display = 'flex';
        if (numbersWrap) numbersWrap.style.display = 'none';

        let currentVisible = perPage;
        updateLoadMoreView(currentVisible);

        if (loadMoreBtn && !loadMoreBtn.__fp_bound) {
          loadMoreBtn.__fp_bound = true;
          loadMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            currentVisible += perPage;
            updateLoadMoreView(currentVisible);
          });
        }
      } else if (paginationType === 'numbers') {
        if (paginationContainer) paginationContainer.style.display = 'flex';
        if (loadMoreWrap) loadMoreWrap.style.display = 'none';
        if (numbersWrap) numbersWrap.style.display = 'inline-flex';

        updateNumbersView(1);

        if (prevBtn && !prevBtn.__fp_bound) {
          prevBtn.__fp_bound = true;
          prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage > 1) {
              updateNumbersView(currentPage - 1);
              try {
                widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } catch (err) {}
            }
          });
        }

        if (nextBtn && !nextBtn.__fp_bound) {
          nextBtn.__fp_bound = true;
          nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentPage < totalPages) {
              updateNumbersView(currentPage + 1);
              try {
                widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
              } catch (err) {}
            }
          });
        }
      }
    });
  }

  // Export globally for GrapesJS editor canvas
  window.FastPressProductsLoop = {
    init: initProductsLoopWidgets,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initProductsLoopWidgets());
  } else {
    initProductsLoopWidgets();
  }

  document.addEventListener('astro:page-load', () => initProductsLoopWidgets());
  document.addEventListener('astro:after-swap', () => initProductsLoopWidgets());
})();
