/* Kitchen TV front end for Mealie.
 *
 * Screens on a stack: home (tabs: recipes, cookbooks, meal plan, organizers),
 * filtered recipe lists, recipe (overview), cook (one step at a time). The remote moves a focus ring between .focusable elements
 * by screen position; Back pops the stack. Plain ES2017 for the TV's
 * Chromium 85 engine, and no build step.
 */
(function () {
    'use strict';

    var CFG = window.KITCHEN_CONFIG || {};
    var SERVER = (CFG.server || '').replace(/\/+$/, '');
    var PAGE_SIZE = 40;

    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
        BACK: 10009, ESC: 27, BACKSPACE: 8,
        PLAY_PAUSE: 10252, PLAY: 415, PAUSE: 19, CH_UP: 427, CH_DOWN: 428,
        IME_DONE: 65376, IME_CANCEL: 65385,
        P: 80 // desktop stand-in for play/pause
    };

    var viewEl = document.getElementById('view');

    /* ---------- Platform ---------- */

    function tv() { return typeof window.tizen !== 'undefined'; }

    try {
        tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'ChannelUp', 'ChannelDown']);
    } catch (e) { /* not on a TV */ }

    function keepAwake(on) {
        try {
            var s = webapis.appcommon.AppCommonScreenSaverState;
            webapis.appcommon.setScreenSaver(on ? s.SCREEN_SAVER_OFF : s.SCREEN_SAVER_ON);
        } catch (e) { /* not on a TV */ }
    }

    function exitApp() {
        try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* browser */ }
    }

    /* ---------- Mealie API ---------- */

    function api(path) {
        return fetch(SERVER + '/api' + path, {
            headers: { Authorization: 'Bearer ' + CFG.token, Accept: 'application/json' }
        }).then(function (r) {
            if (!r.ok) throw new Error('Mealie answered ' + r.status);
            return r.json();
        });
    }

    function imageUrl(recipe, size) {
        if (!recipe || !recipe.image) return null;
        return SERVER + '/api/media/recipes/' + recipe.id + '/images/' + size + '.webp?v=' +
            encodeURIComponent(recipe.image);
    }

    /* ---------- Helpers ---------- */

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Mealie text is Markdown; keep bold, italics and line breaks.
    function richText(s) {
        return esc(s)
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
            .replace(/\n+/g, '<br>');
    }

    var PH_COLORS = ['#8e4b1f', '#5a3d7a', '#2f6b4f', '#7a2f3d', '#2f557a', '#7a6a2f'];

    function picture(recipe, size, cls) {
        var box = el('div', cls);
        var url = imageUrl(recipe, size);
        if (url) {
            var img = el('img');
            img.src = url;
            img.onerror = function () { box.replaceChild(placeholder(recipe), img); };
            box.appendChild(img);
        } else {
            box.appendChild(placeholder(recipe));
        }
        return box;
    }

    function placeholder(recipe) {
        var name = (recipe && recipe.name) || '?';
        var n = 0;
        for (var i = 0; i < name.length; i++) n = (n + name.charCodeAt(i)) % PH_COLORS.length;
        var ph = el('div', 'ph', esc(name.charAt(0).toUpperCase()));
        ph.style.background = 'linear-gradient(135deg, ' + PH_COLORS[n] + ', #1f1f1f)';
        return ph;
    }

    function ingredientText(i) {
        if (i.display) return i.display;
        if (i.note && !i.food) return i.note;
        return [i.quantity || '', i.unit && i.unit.name, i.food && i.food.name, i.note]
            .filter(Boolean).join(' ');
    }

    function ingredientsHtml(list) {
        if (!list || !list.length) return '<p class="hint">No ingredients listed.</p>';
        var out = '<ul>';
        list.forEach(function (i) {
            if (i.title) out += '</ul><h3>' + esc(i.title) + '</h3><ul>';
            out += '<li>' + richText(ingredientText(i)) + '</li>';
        });
        return out + '</ul>';
    }

    function steps(recipe) {
        return (recipe.recipeInstructions || []).filter(function (s) {
            return s.text && s.text.trim();
        });
    }

    // Seconds of the first duration in a step ("cook 8-10 minutes" -> 480).
    function stepSeconds(step) {
        if (step.durationSeconds) return step.durationSeconds;
        var m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i
            .exec(step.text || '');
        if (!m) return 0;
        var unit = m[2].toLowerCase();
        var mult = unit.charAt(0) === 'h' ? 3600 : unit.charAt(0) === 's' ? 1 : 60;
        return Math.min(Math.round(parseFloat(m[1]) * mult), 24 * 3600);
    }

    function formatDuration(sec) {
        var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
        if (h) return h + ':' + pad(m) + ':' + pad(s);
        return m + ':' + pad(s);
    }

    function humanDuration(sec) {
        if (sec >= 3600) {
            var h = Math.floor(sec / 3600), m = Math.round(sec % 3600 / 60);
            return h + ' hr' + (m ? ' ' + m + ' min' : '');
        }
        if (sec >= 60) return Math.round(sec / 60) + ' min';
        return sec + ' sec';
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }

    function recipeMeta(r) {
        var parts = [];
        if (r.totalTime) parts.push(r.totalTime);
        else if (r.prepTime || r.cookTime || r.performTime) parts.push(r.prepTime || r.cookTime || r.performTime);
        if (r.recipeYield) parts.push(r.recipeYield);
        else if (r.recipeServings) parts.push(r.recipeServings + ' servings');
        return parts.join(' · ');
    }

    /* ---------- Focus ---------- */

    var focused = null;

    function visible(e) {
        var r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }

    function focusables(root) {
        return Array.prototype.filter.call((root || viewEl).querySelectorAll('.focusable'), visible);
    }

    function setFocus(e) {
        if (!e) return;
        if (focused) focused.classList.remove('focused');
        focused = e;
        e.classList.add('focused');
        reveal(e);
        if (e.__onFocus) e.__onFocus();
    }

    // Move to the nearest focusable in a direction, judged by on-screen centres.
    function move(dir) {
        if (!focused || !document.contains(focused)) { setFocus(focusables()[0]); return; }
        var a = focused.getBoundingClientRect();
        var ax = a.left + a.width / 2, ay = a.top + a.height / 2;
        var best = null, bestScore = Infinity;
        focusables().forEach(function (e) {
            if (e === focused) return;
            var b = e.getBoundingClientRect();
            var bx = b.left + b.width / 2, by = b.top + b.height / 2;
            var along, across;
            if (dir === 'left') { along = ax - bx; across = Math.abs(by - ay); }
            else if (dir === 'right') { along = bx - ax; across = Math.abs(by - ay); }
            else if (dir === 'up') { along = ay - by; across = Math.abs(bx - ax); }
            else { along = by - ay; across = Math.abs(bx - ax); }
            if (along <= 1) return;
            var sideways = dir === 'left' || dir === 'right';
            var overlap = sideways
                ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
                : Math.min(a.right, b.right) - Math.max(a.left, b.left);
            // Left and right stay in the row; up and down prefer the same column.
            if (sideways && overlap <= 0) return;
            var score = along + (overlap > 0 ? 0 : across * 3);
            if (score < bestScore) { bestScore = score; best = e; }
        });
        if (best) setFocus(best);
    }

    // Scroll any .scroll-y / .scroll-x ancestors so the element is in view.
    function reveal(e) {
        var margin = 40;
        for (var p = e.parentElement; p && p !== viewEl; p = p.parentElement) {
            var pr = p.getBoundingClientRect(), er = e.getBoundingClientRect();
            if (p.classList.contains('scroll-y')) {
                var top = er.top - pr.top + p.scrollTop;
                if (er.top < pr.top + margin) p.scrollTop = Math.max(0, top - margin);
                else if (er.bottom > pr.bottom - margin) p.scrollTop = top + er.height - p.clientHeight + margin;
            }
            if (p.classList.contains('scroll-x')) {
                var left = er.left - pr.left + p.scrollLeft;
                if (er.left < pr.left + margin) p.scrollLeft = Math.max(0, left - margin);
                else if (er.right > pr.right - margin) p.scrollLeft = left + er.width - p.clientWidth + margin;
            }
        }
    }

    function focusable(e, onSelect) {
        e.classList.add('focusable');
        e.__select = onSelect;
        return e;
    }

    // Scroll a pane by a step; returns false at the ends.
    function scrollPane(pane, dy) {
        var max = pane.scrollHeight - pane.clientHeight;
        var from = pane.__target != null ? pane.__target : pane.scrollTop;
        var to = Math.max(0, Math.min(max, from + dy));
        if (to === from) return false;
        pane.__target = to;
        pane.scrollTop = to;
        updateMore(pane, to, max);
        return true;
    }

    function updateMore(pane, at, max) {
        var more = pane.querySelector('.more');
        if (more) more.style.display = max - (at == null ? pane.scrollTop : at) > 4 ? '' : 'none';
    }

    /* ---------- Screens ---------- */

    var stack = [];

    function current() { return stack[stack.length - 1]; }

    function push(view) {
        var top = current();
        if (top) {
            top.lastFocus = focused;
            if (top.root.parentNode) viewEl.removeChild(top.root);
        }
        stack.push(view);
        viewEl.appendChild(view.root);
        if (view.show) view.show();
        setFocus(view.initialFocus ? view.initialFocus() : focusables()[0]);
    }

    function pop() {
        if (stack.length <= 1) { exitApp(); return; }
        var v = stack.pop();
        viewEl.removeChild(v.root);
        if (v.destroy) v.destroy();
        var top = current();
        viewEl.appendChild(top.root);
        if (top.show) top.show();
        setFocus(top.lastFocus && top.root.contains(top.lastFocus) ? top.lastFocus : focusables()[0]);
    }

    function messageView(root, text, detail, retry) {
        root.innerHTML = '';
        var m = el('div', 'message', esc(text) + (detail ? '<small>' + esc(detail) + '</small>' : ''));
        if (retry) {
            m.appendChild(el('br'));
            m.appendChild(focusable(el('div', 'button primary', 'Try again'), retry));
        }
        root.appendChild(m);
        return m;
    }

    /* ---------- Shared pieces for the browsing screens ---------- */

    function recipeCard(recipe, tag) {
        var c = focusable(el('div', 'card'), function () { push(new RecipeView(recipe.slug)); });
        c.appendChild(picture(recipe, 'min-original', 'card-img'));
        var body = el('div', 'card-body');
        if (tag) body.appendChild(el('div', 'tag', esc(tag)));
        body.appendChild(el('div', 'card-name', esc(recipe.name)));
        body.appendChild(el('div', 'card-meta', esc(recipeMeta(recipe)) || '&nbsp;'));
        c.appendChild(body);
        return c;
    }

    // A meal plan entry without a recipe ("Leftovers", "Eat out").
    function noteCard(entry) {
        var c = focusable(el('div', 'card note'), function () {});
        var body = el('div', 'card-body');
        body.appendChild(el('div', 'tag', esc(entry.entryType || 'note')));
        body.appendChild(el('div', 'card-name', esc(entry.title || 'Note')));
        if (entry.text) body.appendChild(el('div', 'note-text', esc(entry.text)));
        c.appendChild(body);
        return c;
    }

    function tile(name, sub, onSelect, imageRecipe) {
        var t = focusable(el('div', 'tile'), onSelect);
        var n = 0;
        for (var i = 0; i < name.length; i++) n = (n + name.charCodeAt(i)) % PH_COLORS.length;
        t.style.background = 'linear-gradient(135deg, ' + PH_COLORS[n] + ', #1f1f1f)';
        var url = imageUrl(imageRecipe, 'min-original');
        if (url) {
            var img = el('img', 'tile-img');
            img.src = url;
            img.onerror = function () { t.removeChild(img); };
            t.appendChild(img);
        }
        t.appendChild(el('div', 'tile-name', esc(name)));
        if (sub) t.appendChild(el('div', 'tile-sub', esc(sub)));
        return t;
    }

    /* A recipe grid that loads 40 at a time, and more as focus nears the end.
       query(page) returns the /recipes query string; label(total) the heading. */
    function RecipeGrid(scroller, query, label, emptyText) {
        var heading, grid, page = 0, pages = 1, loading = false, owner = null;

        function load(reset) {
            if (loading) return;
            if (reset) {
                page = 0;
                heading = el('div', 'section-title', 'Loading…');
                grid = el('div', 'grid');
                scroller.appendChild(heading);
                scroller.appendChild(grid);
            }
            loading = true;
            api('/recipes' + query(page + 1)).then(function (res) {
                loading = false;
                page += 1;
                pages = res.total_pages || 1;
                res.items.forEach(function (r) {
                    var c = recipeCard(r);
                    c.__onFocus = maybeMore;
                    grid.appendChild(c);
                });
                heading.textContent = label(res.total || 0);
                if (!res.total) grid.appendChild(el('div', 'message', emptyText));
                if (owner && current() === owner && (!focused || !owner.root.contains(focused))) {
                    setFocus(grid.querySelector('.focusable'));
                }
            }).catch(function (err) {
                loading = false;
                if (page) return;
                heading.textContent = '';
                messageView(grid, 'Can’t reach Mealie', err.message + ' · ' + SERVER, function () {
                    scroller.removeChild(heading); scroller.removeChild(grid); load(true);
                });
            });
        }

        function maybeMore() {
            var cards = grid.children, idx = Array.prototype.indexOf.call(cards, focused);
            if (idx >= cards.length - 10 && page < pages) load(false);
        }

        this.load = function (view) { owner = view; load(true); };
    }

    // Loads a list into tiles: fetch() resolves to items; each item -> tile.
    function fillTiles(box, fetch, makeTile, emptyText) {
        box.innerHTML = '';
        var grid = el('div', 'grid');
        box.appendChild(el('div', 'section-title', 'Loading…'));
        box.appendChild(grid);
        return fetch().then(function (items) {
            box.firstChild.textContent = '';
            if (!items.length) { grid.appendChild(el('div', 'message', emptyText)); return; }
            box.removeChild(box.firstChild);
            items.forEach(function (it) { grid.appendChild(makeTile(it)); });
        }).catch(function (err) {
            box.innerHTML = '';
            messageView(box, 'Can’t reach Mealie', err.message, function () { fillTiles(box, fetch, makeTile, emptyText); });
        });
    }

    function isoDate(d) {
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'side', 'snack', 'drink', 'dessert'];

    function dayLabel(d, offset) {
        if (offset === 0) return 'Today';
        if (offset === 1) return 'Tomorrow';
        return DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    }

    /* ---------- Home: tabs ---------- */

    function HomeView() {
        var self = this;
        var root = this.root = el('div', 'home');
        var clock = el('div', 'clock');
        var top = el('div', 'topbar');
        var tabsRow = el('div', 'tabs');
        top.appendChild(el('div', 'brand', 'Kitchen <span>Recipes</span>'));
        top.appendChild(tabsRow);
        top.appendChild(clock);
        var body = el('div', 'tab-body');
        root.appendChild(top);
        root.appendChild(body);

        var timerId;
        function tick() {
            var d = new Date(), h = d.getHours() % 12 || 12;
            clock.textContent = h + ':' + pad(d.getMinutes());
        }
        this.show = function () { tick(); timerId = setInterval(tick, 15000); keepAwake(false); };
        this.destroy = function () { clearInterval(timerId); };

        var panels = [
            { name: 'Recipes', make: RecipesPanel },
            { name: 'Cookbooks', make: CookbooksPanel },
            { name: 'Meal plan', make: MealPlanPanel },
            { name: 'Organizers', make: OrganizersPanel }
        ];
        var active = null, switchTimer = null;

        panels.forEach(function (p) {
            p.tab = focusable(el('div', 'tab', esc(p.name)), function () { select(p); });
            // Moving onto a tab switches to it, after a pause so passing through doesn't load each one.
            p.tab.__onFocus = function () {
                clearTimeout(switchTimer);
                switchTimer = setTimeout(function () { if (focused === p.tab) select(p); }, 250);
            };
            tabsRow.appendChild(p.tab);
        });

        function select(p) {
            if (active === p) return;
            if (active) { active.tab.classList.remove('selected'); body.removeChild(active.panel.root); }
            active = p;
            p.tab.classList.add('selected');
            if (!p.panel) p.panel = new p.make(self);
            body.appendChild(p.panel.root);
            if (p.panel.shown) p.panel.shown();
        }

        this.onKey = function (code) {
            var inTabs = focused && tabsRow.contains(focused);
            // Back from the content goes to the tabs; Back on the tabs exits.
            if ((code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE) && !inTabs) {
                setFocus(active.tab);
                return true;
            }
            // Down from the tabs starts at the top left of the content.
            if (code === KEY.DOWN && inTabs) {
                if (focused !== active.tab) select(panels.filter(function (p) { return p.tab === focused; })[0]);
                var first = focusables(body)[0];
                if (first) setFocus(first);
                return true;
            }
            return false;
        };

        this.initialFocus = function () { return panels[0].tab; };
        select(panels[0]);
    }

    /* Recipes tab: search, A–Z, newest, and today's meals. */
    function RecipesPanel(home) {
        var state = { filter: 'az', search: '' };
        var root = this.root = el('div', 'panel');
        var filters = el('div', 'filters scroll-x');
        var scroller = el('div', 'scroller scroll-y');
        root.appendChild(filters);
        root.appendChild(scroller);

        function chip(label, key) {
            var c = focusable(el('div', 'chip' + (state.filter === key ? ' active' : ''), esc(label)), function () {
                state.filter = key;
                state.search = '';
                renderFilters(key);
                load();
            });
            c.setAttribute('data-key', key);
            return c;
        }

        // Rebuilds the chips; keeps focus on the chip with focusKey.
        function renderFilters(focusKey) {
            filters.innerHTML = '';
            var label = state.search ? 'Search: “' + state.search + '”' : 'Search';
            var s = focusable(el('div', 'chip search' + (state.search ? ' active' : ''), esc(label)), openSearch);
            filters.appendChild(s);
            filters.appendChild(chip('All A–Z', 'az'));
            filters.appendChild(chip('Newest', 'new'));
            if (focusKey) setFocus(focusKey === 'search' ? s : filters.querySelector('[data-key="' + focusKey + '"]'));
        }

        function openSearch() {
            var chipEl = focused;
            var input = el('input', 'search-input');
            input.type = 'text';
            input.placeholder = 'Search recipes';
            input.value = state.search;
            filters.replaceChild(input, chipEl);
            input.__done = function (apply) {
                if (apply) {
                    state.search = input.value.trim();
                    if (state.search) state.filter = 'search';
                    else if (state.filter === 'search') state.filter = 'az';
                }
                input.blur();
                renderFilters('search');
                if (apply) load();
            };
            input.focus();
        }

        function load() {
            scroller.innerHTML = '';
            scroller.scrollTop = 0;
            if (state.filter === 'az' && !state.search) renderToday();
            new RecipeGrid(scroller, function (page) {
                var q = '?page=' + page + '&perPage=' + PAGE_SIZE;
                q += state.filter === 'new' ? '&orderBy=created_at&orderDirection=desc' : '&orderBy=name&orderDirection=asc';
                if (state.search) q += '&search=' + encodeURIComponent(state.search);
                return q;
            }, function (total) {
                return (state.search ? 'Results for “' + state.search + '”'
                    : state.filter === 'new' ? 'Newest recipes' : 'All recipes') + ' · ' + total;
            }, state.search ? 'Nothing matches.'
                : 'No recipes yet.<small>Add some in Mealie, or send @qwen a recipe link.</small>').load(home);
        }

        function renderToday() {
            var box = el('div');
            scroller.insertBefore(box, scroller.firstChild);
            api('/households/mealplans/today').then(function (today) {
                today = (today || []).filter(function (t) { return t.recipe; });
                if (!today.length) return;
                box.appendChild(el('div', 'section-title', 'Today'));
                var row = el('div', 'grid today');
                today.forEach(function (t) { row.appendChild(recipeCard(t.recipe, t.entryType)); });
                box.appendChild(row);
            }).catch(function () {});
        }

        renderFilters();
        load();
    }

    /* Cookbooks tab: one tile per cookbook, opening its recipes. */
    function CookbooksPanel() {
        var root = this.root = el('div', 'panel');
        var scroller = el('div', 'scroller scroll-y');
        root.appendChild(scroller);

        fillTiles(scroller, function () {
            return api('/households/cookbooks?perPage=-1&orderBy=position&orderDirection=asc').then(function (res) {
                var books = res.items || [];
                // A picture for each tile: the newest recipe in that cookbook.
                return Promise.all(books.map(function (b) {
                    return api('/recipes?perPage=1&orderBy=created_at&orderDirection=desc&cookbook=' + encodeURIComponent(b.id))
                        .then(function (r) { b.cover = r.items[0]; b.count = r.total; })
                        .catch(function () {});
                })).then(function () { return books; });
            });
        }, function (b) {
            var sub = b.count != null ? b.count + (b.count === 1 ? ' recipe' : ' recipes') : (b.description || '');
            return tile(b.name, sub, function () {
                push(new RecipeListView(b.name, '&cookbook=' + encodeURIComponent(b.id)));
            }, b.cover);
        }, 'No cookbooks yet.<small>Create them in Mealie under Cookbooks: each one is a saved filter.</small>');
    }

    /* Meal plan tab: the next two weeks, a row of meals per day. */
    function MealPlanPanel() {
        var root = this.root = el('div', 'panel');
        var scroller = el('div', 'scroller scroll-y');
        root.appendChild(scroller);
        var loadedFor = '';

        function load() {
            var start = new Date();
            start.setHours(0, 0, 0, 0);
            var end = new Date(start.getTime());
            end.setDate(end.getDate() + 13);
            loadedFor = isoDate(start);
            scroller.innerHTML = '';
            scroller.appendChild(el('div', 'section-title', 'Loading…'));
            api('/households/mealplans?perPage=-1&start_date=' + isoDate(start) + '&end_date=' + isoDate(end) +
                '&orderBy=date&orderDirection=asc').then(function (res) {
                scroller.innerHTML = '';
                var byDay = {};
                (res.items || []).forEach(function (e) { (byDay[e.date] = byDay[e.date] || []).push(e); });
                var any = false;
                for (var i = 0; i < 14; i++) {
                    var d = new Date(start.getTime());
                    d.setDate(d.getDate() + i);
                    var entries = byDay[isoDate(d)];
                    if (!entries) continue;
                    any = true;
                    entries.sort(function (a, b) {
                        return MEAL_ORDER.indexOf(a.entryType) - MEAL_ORDER.indexOf(b.entryType);
                    });
                    scroller.appendChild(el('div', 'section-title day', esc(dayLabel(d, i))));
                    var row = el('div', 'grid');
                    entries.forEach(function (e) { row.appendChild(e.recipe ? recipeCard(e.recipe, e.entryType) : noteCard(e)); });
                    scroller.appendChild(row);
                }
                if (!any) {
                    scroller.appendChild(el('div', 'message',
                        'Nothing planned for the next two weeks.<small>Plan meals in Mealie’s Meal Planner.</small>'));
                }
            }).catch(function (err) {
                scroller.innerHTML = '';
                messageView(scroller, 'Can’t reach Mealie', err.message, load);
            });
        }

        // Reload when shown on a new day (the TV may stay on overnight).
        this.shown = function () { if (loadedFor !== isoDate(new Date())) load(); };
    }

    /* Organizers tab: categories, tags and tools that have recipes. */
    function OrganizersPanel() {
        var kinds = [
            { key: 'categories', label: 'Categories', param: 'categories' },
            { key: 'tags', label: 'Tags', param: 'tags' },
            { key: 'tools', label: 'Tools', param: 'tools' }
        ];
        var kind = kinds[0];
        var root = this.root = el('div', 'panel');
        var filters = el('div', 'filters scroll-x');
        var scroller = el('div', 'scroller scroll-y');
        root.appendChild(filters);
        root.appendChild(scroller);

        function renderFilters(focusKey) {
            filters.innerHTML = '';
            kinds.forEach(function (k) {
                var c = focusable(el('div', 'chip' + (k === kind ? ' active' : ''), esc(k.label)), function () {
                    kind = k;
                    renderFilters(k.key);
                    load();
                });
                c.setAttribute('data-key', k.key);
                filters.appendChild(c);
            });
            if (focusKey) setFocus(filters.querySelector('[data-key="' + focusKey + '"]'));
        }

        function load() {
            var k = kind;
            scroller.scrollTop = 0;
            fillTiles(scroller, function () {
                return Promise.all([
                    api('/organizers/' + k.key + '?perPage=-1&orderBy=name&orderDirection=asc'),
                    api('/organizers/' + k.key + '/empty').catch(function () { return []; })
                ]).then(function (res) {
                    var empty = {};
                    (res[1] || []).forEach(function (e) { empty[e.id] = true; });
                    return (res[0].items || []).filter(function (o) { return !empty[o.id]; });
                });
            }, function (o) {
                return tile(o.name, '', function () {
                    push(new RecipeListView(o.name, '&' + k.param + '=' + encodeURIComponent(o.id)));
                });
            }, 'No ' + k.label.toLowerCase() + ' with recipes yet.<small>Add them to recipes in Mealie.</small>');
        }

        renderFilters();
        load();
    }

    /* A filtered list of recipes (a cookbook, category, tag or tool). */
    function RecipeListView(title, filter) {
        var root = this.root = el('div', 'home');
        var top = el('div', 'topbar');
        top.appendChild(el('div', 'brand', esc(title)));
        top.appendChild(el('div', 'clock hint-top', 'Back: return'));
        var scroller = el('div', 'scroller scroll-y');
        root.appendChild(top);
        root.appendChild(scroller);
        this.show = function () { keepAwake(false); };
        this.initialFocus = function () { return root.querySelector('.focusable'); };

        new RecipeGrid(scroller, function (page) {
            return '?page=' + page + '&perPage=' + PAGE_SIZE + '&orderBy=name&orderDirection=asc' + filter;
        }, function (total) {
            return total + (total === 1 ? ' recipe' : ' recipes');
        }, 'No recipes here yet.').load(this);
    }

    /* Recipe: picture, details, ingredients and steps. */
    function RecipeView(slug) {
        var self = this;
        var root = this.root = el('div', 'recipe');
        var recipe = null;
        this.show = function () { keepAwake(true); };

        function render(r) {
            recipe = r;
            root.innerHTML = '';
            var left = el('div', 'recipe-left');
            left.appendChild(picture(r, 'original', 'hero'));
            var ing = paneEl('Ingredients', ingredientsHtml(r.recipeIngredient), 'ingredients-pane');
            left.appendChild(ing);

            var right = el('div', 'recipe-right');
            right.appendChild(el('div', 'recipe-title', esc(r.name)));
            var meta = el('div', 'meta');
            [['Total', r.totalTime], ['Prep', r.prepTime], ['Cook', r.cookTime || r.performTime],
             ['Makes', r.recipeYield || (r.recipeServings ? r.recipeServings + ' servings' : '')]]
                .forEach(function (m) { if (m[1]) meta.appendChild(el('div', null, '<b>' + m[0] + '</b>' + esc(m[1]))); });
            if (meta.children.length) right.appendChild(meta);
            if (r.description) right.appendChild(el('div', 'description', richText(r.description)));

            var list = steps(r);
            var actions = el('div', 'recipe-actions');
            if (list.length) {
                self.cookBtn = focusable(el('div', 'button primary', 'Start cooking'), function () { push(new CookView(r)); });
                actions.appendChild(self.cookBtn);
                right.appendChild(actions);
            }
            var stepsHtml = list.length
                ? '<ol>' + list.map(function (s) {
                    return (s.title ? '</ol><h3>' + esc(s.title) + '</h3><ol>' : '') + '<li>' + richText(s.text) + '</li>';
                }).join('') + '</ol>'
                : '<p class="hint">No steps listed.</p>';
            var stepsPane = paneEl('Steps', stepsHtml, 'steps-pane');
            right.appendChild(stepsPane);
            right.appendChild(el('div', 'hint', '▲▼ scroll · ◀▶ switch · Back to recipes'));

            root.appendChild(left);
            root.appendChild(right);
            [ing, stepsPane].forEach(function (p) { updateMore(p); });
            setFocus(self.cookBtn || stepsPane);
        }

        function paneEl(title, html, cls) {
            var p = focusable(el('div', 'pane ' + cls, '<h2>' + title + '</h2>' + html + '<div class="more">more ▼</div>'));
            p.__pane = true;
            return p;
        }

        this.onKey = function (code) {
            if (!focused || !focused.__pane) return false;
            if (code === KEY.DOWN || code === KEY.CH_DOWN) { scrollPane(focused, 240); return true; }
            if (code === KEY.UP || code === KEY.CH_UP) {
                // At the top, Up leaves the pane.
                return scrollPane(focused, -240) || code === KEY.CH_UP;
            }
            return false;
        };

        this.initialFocus = function () { return root.querySelector('.focusable'); };

        function load() {
            messageView(root, 'Loading…');
            api('/recipes/' + encodeURIComponent(slug)).then(function (r) {
                if (current() === self) render(r);
                else recipe = r;
            }).catch(function (err) {
                messageView(root, 'Couldn’t load this recipe', err.message, load);
                if (current() === self) setFocus(root.querySelector('.focusable'));
            });
        }
        load();
    }

    /* Cooking: one step at a time, ingredients alongside, step timers. */
    function CookView(recipe) {
        var self = this;
        var list = steps(recipe);
        var i = 0;
        var root = this.root = el('div', 'cook');
        this.show = function () { keepAwake(true); };

        var head = el('div', 'cook-head');
        head.appendChild(el('div', 'cook-name', esc(recipe.name)));
        var count = el('div', 'cook-count');
        head.appendChild(count);
        var bar = el('div', 'progress', '<div></div>');
        var main = el('div', 'cook-main');
        var stepBox = el('div', 'step');
        var side = el('div', 'cook-side');
        var pane = el('div', 'pane', '<h2>Ingredients</h2>' + ingredientsHtml(recipe.recipeIngredient) +
            '<div class="more">more ▼</div>');
        side.appendChild(pane);
        main.appendChild(stepBox);
        main.appendChild(side);
        var foot = el('div', 'cook-foot');
        root.appendChild(head);
        root.appendChild(bar);
        root.appendChild(main);
        root.appendChild(foot);

        // The cook screen has no focus targets of its own; keys drive it directly.
        var anchor = focusable(el('div', 'anchor'));
        anchor.style.cssText = 'position:absolute;width:1px;height:1px;top:0;left:0';
        root.appendChild(anchor);
        this.initialFocus = function () { return anchor; };

        function render() {
            var done = i >= list.length;
            count.textContent = done ? 'Done' : 'Step ' + (i + 1) + ' of ' + list.length;
            bar.firstChild.style.width = (done ? 100 : (i + 1) / list.length * 100) + '%';
            stepBox.className = 'step' + (done ? ' done' : '');
            if (done) {
                stepBox.innerHTML = '<div class="step-text">All done. Enjoy!</div>';
                foot.innerHTML = '<span>◀ last step</span><span>OK or Back: return to the recipe</span>';
                return;
            }
            var s = list[i];
            var text = s.text.trim();
            var size = text.length > 420 ? ' very-long' : text.length > 240 ? ' long' : '';
            var secs = stepSeconds(s);
            stepBox.innerHTML = (s.title ? '<div class="step-title">' + esc(s.title) + '</div>' : '') +
                '<div class="step-text' + size + '">' + richText(text) + '</div>' +
                (secs ? '<div class="step-timer">Timer: <b>' + humanDuration(secs) + '</b> · press ▶❚❚ to start</div>' : '');
            foot.innerHTML = '<span>◀ ▶ steps</span><span>OK next</span><span>▲▼ ingredients</span>' +
                (secs ? '<span>▶❚❚ timer</span>' : '') + '<span>Back: recipe</span>';
            updateMore(pane);
        }

        this.onKey = function (code) {
            if (code === KEY.RIGHT || code === KEY.ENTER) {
                // Only OK leaves the last screen, so an extra press of Right doesn't.
                if (i >= list.length) { if (code === KEY.ENTER) pop(); return true; }
                i++; render(); return true;
            }
            if (code === KEY.LEFT) { if (i > 0) { i--; render(); } return true; }
            if (code === KEY.DOWN || code === KEY.CH_DOWN) { scrollPane(pane, 200); return true; }
            if (code === KEY.UP || code === KEY.CH_UP) { scrollPane(pane, -200); return true; }
            if (code === KEY.PLAY_PAUSE || code === KEY.PLAY || code === KEY.PAUSE || code === KEY.P) {
                if (timer.running()) timer.cancel();
                else if (i < list.length && stepSeconds(list[i])) {
                    timer.start(stepSeconds(list[i]), recipe.name + ' · step ' + (i + 1));
                }
                return true;
            }
            return false;
        };

        render();
    }

    /* ---------- Kitchen timer (one at a time, survives screen changes) ---------- */

    var timer = (function () {
        var box = document.getElementById('timer');
        var alarm = document.getElementById('alarm');
        var alarmLabel = document.getElementById('alarm-label');
        var endAt = 0, label = '', interval = null, beeper = null, audio = null;

        function draw() {
            var left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
            box.innerHTML = formatDuration(left) + '<small>▶❚❚ cancel</small>';
            if (left <= 0) ring();
        }

        function beep() {
            try {
                audio = audio || new (window.AudioContext || window.webkitAudioContext)();
                [0, 0.25, 0.5].forEach(function (t) {
                    var o = audio.createOscillator(), g = audio.createGain();
                    o.frequency.value = 880;
                    g.gain.value = 0.3;
                    o.connect(g); g.connect(audio.destination);
                    o.start(audio.currentTime + t);
                    o.stop(audio.currentTime + t + 0.15);
                });
            } catch (e) { /* no audio */ }
        }

        function ring() {
            clearInterval(interval); interval = null;
            box.classList.add('hidden');
            alarmLabel.textContent = label;
            alarm.classList.remove('hidden');
            beep();
            beeper = setInterval(beep, 1500);
            keepAwake(true);
        }

        return {
            running: function () { return !!interval; },
            ringing: function () { return !!beeper; },
            start: function (secs, what) {
                endAt = Date.now() + secs * 1000;
                label = what;
                box.classList.remove('hidden');
                draw();
                interval = setInterval(draw, 500);
            },
            cancel: function () {
                clearInterval(interval); interval = null;
                box.classList.add('hidden');
            },
            dismiss: function () {
                clearInterval(beeper); beeper = null;
                alarm.classList.add('hidden');
            }
        };
    })();

    /* ---------- Keys ---------- */

    document.addEventListener('keydown', function (e) {
        var code = e.keyCode;

        if (timer.ringing()) { timer.dismiss(); e.preventDefault(); return; }

        // The on-screen keyboard owns keys while the search box is open.
        var active = document.activeElement;
        if (active && active.tagName === 'INPUT') {
            if (code === KEY.IME_DONE || code === KEY.ENTER) { active.__done(true); e.preventDefault(); }
            else if (code === KEY.IME_CANCEL || code === KEY.BACK || code === KEY.ESC) { active.__done(false); e.preventDefault(); }
            return;
        }

        var view = current();
        if (view && view.onKey && view.onKey(code)) { e.preventDefault(); return; }

        switch (code) {
            case KEY.LEFT: move('left'); break;
            case KEY.RIGHT: move('right'); break;
            case KEY.UP: move('up'); break;
            case KEY.DOWN: move('down'); break;
            case KEY.ENTER: if (focused && focused.__select) focused.__select(); break;
            case KEY.BACK: case KEY.ESC: case KEY.BACKSPACE: pop(); break;
            case KEY.PLAY_PAUSE: case KEY.PLAY: case KEY.PAUSE: case KEY.P:
                if (timer.running()) timer.cancel();
                break;
            default: return;
        }
        e.preventDefault();
    });

    /* ---------- Start ---------- */

    if (!SERVER || !CFG.token) {
        var root = el('div', 'home');
        messageView(root, 'Not set up', 'js/config.js needs the Mealie address and an API token.');
        viewEl.appendChild(root);
    } else {
        push(new HomeView());
    }

    window.__kitchen = { tv: tv(), timer: timer }; // for debugging from the inspector
})();
