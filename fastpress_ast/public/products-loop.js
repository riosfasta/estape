// FastPress Products Loop Interactive Runtime
(function () {
  function setCardVisible(card, visible) {
    if (visible) {
      card.removeAttribute('hidden');
      card.style.display = 'flex';
    } else {
      card.style.display = 'none';
      card.setAttribute('hidden', '');
    }
  }

  function cardMatchesFilter(card, category, searchTokens) {
    if (category && category !== 'all') {
      const normCat = category.replace(/[-_]/g, ' ').trim();
      const cardCat = (card.getAttribute('data-category') || '').toLowerCase().replace(/[-_]/g, ' ').trim();
      const cardCats = (card.getAttribute('data-categories') || '').toLowerCase().replace(/[-_]/g, ' ');
      const titleBadge = (card.querySelector('.fs-card-category, .fp-card-category')?.textContent || '').toLowerCase().trim();
      const catHit =
        (cardCat && (cardCat === normCat || cardCat.includes(normCat) || normCat.includes(cardCat))) ||
        cardCats.includes(normCat) ||
        (titleBadge && (titleBadge === normCat || titleBadge.includes(normCat)));
      if (!catHit) return false;
    }

    if (searchTokens && searchTokens.length > 0) {
      const hay = [
        card.getAttribute('data-search') || '',
        card.getAttribute('data-title') || '',
        card.getAttribute('data-category') || '',
        card.getAttribute('data-categories') || '',
        card.textContent || '',
      ].join(' ').toLowerCase();
      if (!searchTokens.every((t) => hay.includes(t))) return false;
    }

    return true;
  }

  function initProductsLoopWidgets(rootDoc) {
    const doc = rootDoc || document;
    const widgets = doc.querySelectorAll('.fp-products-loop-widget');

    widgets.forEach((widget) => {
      widget.__fp_loop_initialized = true;

      const paginationType = widget.getAttribute('data-pagination-type') || 'load-more';
      const perPage = parseInt(widget.getAttribute('data-per-page') || '6', 10) || 6;
      const columns = parseInt(widget.getAttribute('data-columns') || '3', 10) || 3;
      const defaultCategory = (widget.getAttribute('data-category') || 'all').toLowerCase().trim();
      const orderby = widget.getAttribute('data-orderby') || 'default';

      widget.style.setProperty('--fp-grid-cols', columns);
      const grid = widget.querySelector('.fp-products-grid');
      if (grid) {
        grid.style.setProperty('--fp-grid-cols', columns);
      }

      const allCards = Array.from(widget.querySelectorAll('.fp-product-card'));
      if (allCards.length === 0) return;

      const paginationContainer = widget.querySelector('.fp-products-pagination');
      const loadMoreWrap = widget.querySelector('.fp-pagination-load-more-wrap');
      const loadMoreBtn = widget.querySelector('.fp-load-more-btn');
      const countCurrentEl = widget.querySelector('.fp-count-current');
      const countTotalEl = widget.querySelector('.fp-count-total');
      const numbersWrap = widget.querySelector('.fp-pagination-numbers-wrap');
      const pageNumbersContainer = widget.querySelector('.fp-page-numbers');
      const prevBtn = widget.querySelector('.fp-prev-btn');
      const nextBtn = widget.querySelector('.fp-next-btn');

      const state = widget.__fpState || {
        category: defaultCategory,
        searchTokens: [],
        currentVisible: perPage,
        currentPage: 1,
        matchedCards: allCards,
      };
      widget.__fpState = state;

      function computeMatchedCards() {
        let list = allCards.filter((card) => cardMatchesFilter(card, state.category, state.searchTokens));
        if (orderby === 'price-asc') {
          list.sort((a, b) => parseFloat(a.getAttribute('data-price') || '0') - parseFloat(b.getAttribute('data-price') || '0'));
        } else if (orderby === 'price-desc') {
          list.sort((a, b) => parseFloat(b.getAttribute('data-price') || '0') - parseFloat(a.getAttribute('data-price') || '0'));
        }
        state.matchedCards = list;

        allCards.forEach((c) => {
          if (!list.includes(c)) setCardVisible(c, false);
        });
        if (countTotalEl) {
          countTotalEl.textContent = String(list.length);
        }
      }

      function renderView() {
        const matchedCards = state.matchedCards;
        const totalItems = matchedCards.length;
        const totalPages = Math.ceil(totalItems / perPage) || 1;

        if (paginationType === 'none') {
          if (paginationContainer) paginationContainer.style.display = 'none';
          matchedCards.forEach((card, idx) => setCardVisible(card, idx < perPage));
          return;
        }

        if (paginationType === 'load-more') {
          if (paginationContainer) paginationContainer.style.display = totalItems > 0 ? 'flex' : 'none';
          if (loadMoreWrap) loadMoreWrap.style.display = 'flex';
          if (numbersWrap) numbersWrap.style.display = 'none';

          const visibleLimit = state.currentVisible;
          matchedCards.forEach((card, idx) => setCardVisible(card, idx < visibleLimit));

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
          return;
        }

        if (paginationType === 'numbers') {
          if (paginationContainer) paginationContainer.style.display = totalItems > 0 ? 'flex' : 'none';
          if (loadMoreWrap) loadMoreWrap.style.display = 'none';
          if (numbersWrap) numbersWrap.style.display = 'inline-flex';

          if (state.currentPage > totalPages) state.currentPage = totalPages;
          const startIndex = (state.currentPage - 1) * perPage;
          const endIndex = startIndex + perPage;
          matchedCards.forEach((card, idx) => setCardVisible(card, idx >= startIndex && idx < endIndex));

          if (pageNumbersContainer) {
            pageNumbersContainer.innerHTML = '';
            for (let p = 1; p <= totalPages; p++) {
              const btn = doc.createElement('button');
              btn.type = 'button';
              btn.className = 'fp-page-num' + (p === state.currentPage ? ' is-active' : '');
              btn.setAttribute('data-page', String(p));
              btn.textContent = String(p);
              btn.addEventListener('click', (e) => {
                e.preventDefault();
                state.currentPage = p;
                renderView();
                try {
                  widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } catch (err) {}
              });
              pageNumbersContainer.appendChild(btn);
            }
          }

          if (prevBtn) prevBtn.disabled = state.currentPage <= 1;
          if (nextBtn) nextBtn.disabled = state.currentPage >= totalPages;
        }
      }

      widget.__fpApplyFilter = function (category, searchTokens) {
        state.category = (category || 'all').toLowerCase().trim();
        state.searchTokens = Array.isArray(searchTokens) ? searchTokens : [];
        state.currentVisible = perPage;
        state.currentPage = 1;
        computeMatchedCards();
        renderView();
        return state.matchedCards.length;
      };

      if (!widget.__fp_filter_bound) {
        widget.__fp_filter_bound = true;
        widget.addEventListener('fp:catalog-filter', (e) => {
          const detail = e.detail || {};
          widget.__fpApplyFilter(detail.category || 'all', detail.tokens || []);
        });
      }

      if (loadMoreBtn && !loadMoreBtn.__fp_bound) {
        loadMoreBtn.__fp_bound = true;
        loadMoreBtn.addEventListener('click', (e) => {
          e.preventDefault();
          state.currentVisible += perPage;
          renderView();
        });
      }

      if (prevBtn && !prevBtn.__fp_bound) {
        prevBtn.__fp_bound = true;
        prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          if (state.currentPage > 1) {
            state.currentPage -= 1;
            renderView();
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
          const totalPages = Math.ceil(state.matchedCards.length / perPage) || 1;
          if (state.currentPage < totalPages) {
            state.currentPage += 1;
            renderView();
            try {
              widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (err) {}
          }
        });
      }

      computeMatchedCards();
      renderView();
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
