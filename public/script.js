// ==========================================
// TOAST NOTIFICATIONS HELPER
// ==========================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast-container');
    const msgSpan = document.getElementById('toast-message');
    const iconSpan = document.getElementById('toast-icon');

    if (!toast || !msgSpan || !iconSpan) return;

    msgSpan.innerText = message;
    
    // Set icon and class based on type
    toast.className = 'toast show';
    if (type === 'success') {
        toast.classList.add('toast-success');
        iconSpan.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    } else if (type === 'error') {
        toast.classList.add('toast-error');
        iconSpan.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
    }

    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==========================================
// MODALS TOGGLERS
// ==========================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

// Close modal when clicking outside the window
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
        e.target.classList.remove('active');
    }
});


// ==========================================
// GLOBAL LOGOUT
// ==========================================
async function logout(e) {
    if (e) e.preventDefault();
    try {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        if (res.ok) {
            localStorage.removeItem('user');
            showToast('Sessão encerrada.', 'success');
            setTimeout(() => {
                window.location.href = '/index.html';
            }, 500);
        }
    } catch (err) {
        console.error(err);
        showToast('Erro ao encerrar sessão.', 'error');
    }
}


// ==========================================
// DYNAMIC NAVIGATION BAR SETUP
// ==========================================
async function setupNavigationBar() {
    const nav = document.getElementById('topbar-nav');
    if (!nav) return;

    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            const user = data.user;
            localStorage.setItem('user', JSON.stringify(user));

            // Set dashboard button based on user role
            let dashboardHref = '/my-area';
            let dashboardLabel = 'A Minha Área';
            let dashboardIcon = 'fa-circle-user';

            if (user.role === 'producer') {
                dashboardHref = '/dashboard';
                dashboardLabel = 'Painel Produtor';
                dashboardIcon = 'fa-sliders';
            } else if (user.role === 'promoter') {
                dashboardHref = '/promoter';
                dashboardLabel = 'Painel Promotor';
                dashboardIcon = 'fa-chart-line';
            } else if (user.role === 'staff') {
                dashboardHref = '/scanner';
                dashboardLabel = 'Scanner';
                dashboardIcon = 'fa-qrcode';
            }

            nav.innerHTML = `
                <a href="${dashboardHref}"><i class="fa-solid ${dashboardIcon}"></i> ${dashboardLabel}</a>
                <a href="#" class="btn-secondary" onclick="logout(event)"><i class="fa-solid fa-right-from-bracket"></i> Sair</a>
            `;
        } else {
            // User not logged in, keep default nav
            localStorage.removeItem('user');
        }
    } catch (err) {
        console.error("Auth verify failed: ", err);
    }
}


// ==========================================
// HOMEPAGE EVENT GRID & FILTERS
// ==========================================
let currentEvents = [];
let checkoutEventId = null;
let guestlistEventId = null;
let selectedGuestlistId = null;

if (document.getElementById('eventsgrid')) {
    document.addEventListener('DOMContentLoaded', () => {
        setupNavigationBar();
        loadEvents();
        setupFilterListeners();
        checkQueryParameters();
    });
}

async function loadEvents() {
    const search = document.getElementById('input-search').value;
    const style = document.getElementById('select-style').value;
    const date = document.getElementById('input-date').value;
    const grid = document.getElementById('eventsgrid');

    let url = `/api/events?1=1`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (style) url += `&style=${encodeURIComponent(style)}`;
    if (date) url += `&date=${encodeURIComponent(date)}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error();
        const events = await res.json();
        currentEvents = events;
        renderEventsGrid(events);
    } catch (err) {
        console.error(err);
        grid.innerHTML = `
            <div style="text-align: center; grid-column: 1 / -1; padding: 3rem;">
                <i class="fa-solid fa-circle-exclamation" style="font-size: 2rem; color: var(--color-danger);"></i>
                <p style="margin-top: 1rem; color: var(--color-danger);">Falha ao carregar eventos da base de dados.</p>
            </div>
        `;
    }
}

function renderEventsGrid(events) {
    const grid = document.getElementById('eventsgrid');
    grid.innerHTML = '';

    if (events.length === 0) {
        grid.innerHTML = `
            <div style="text-align: center; grid-column: 1 / -1; padding: 3rem; color: var(--text-muted);">
                <i class="fa-regular fa-calendar-times" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                <p>Nenhum evento encontrado para os filtros selecionados.</p>
            </div>
        `;
        return;
    }

    events.forEach(evt => {
        const dateObj = new Date(evt.date);
        const dateStr = dateObj.toLocaleDateString('pt-PT', { weekday: 'short', day: '2-digit', month: 'short' });
        const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        const price = parseFloat(evt.ticket_price);
        const priceDisplay = price === 0 ? 'Grátis' : `${price.toFixed(2)}€`;

        grid.innerHTML += `
            <div class="event-card">
                <div class="event-banner bg-${evt.image_url || 'default_event'}">
                    <span class="event-style-badge">${evt.event_style || 'Geral'}</span>
                </div>
                <div class="event-details">
                    <h3 class="event-title">${evt.title}</h3>
                    
                    <div class="event-info-row">
                        <i class="fa-regular fa-calendar"></i>
                        <span>${dateStr} às ${timeStr}</span>
                    </div>
                    
                    <div class="event-info-row">
                        <i class="fa-solid fa-location-dot"></i>
                        <span>${evt.location}</span>
                    </div>

                    <div class="event-info-row" style="font-size:0.85rem; margin-top: 0.2rem;">
                        <i class="fa-solid fa-building"></i>
                        <span>Organizado por: ${evt.producer_name || 'Lux Club'}</span>
                    </div>
                    
                    <p class="event-desc">${evt.description || 'Sem descrição disponível.'}</p>
                    
                    <div class="card-footer">
                        <div class="event-price-tag">
                            ${priceDisplay} ${price > 0 ? '<span>/ ingresso</span>' : ''}
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-secondary" style="padding: 0.5rem 0.8rem; font-size: 0.85rem;" onclick="openGuestlistFlow(${evt.id})">GuestList</button>
                            <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.85rem;" onclick="openPurchaseFlow(${evt.id})"><i class="fa-solid fa-ticket"></i> Bilhetes</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
}

function setupFilterListeners() {
    const searchInput = document.getElementById('input-search');
    const styleSelect = document.getElementById('select-style');
    const dateInput = document.getElementById('input-date');
    const clearBtn = document.getElementById('btn-clear-filters');

    // Debounced search
    let timeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(loadEvents, 300);
    });

    styleSelect.addEventListener('change', loadEvents);
    dateInput.addEventListener('change', loadEvents);

    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        styleSelect.value = '';
        dateInput.value = '';
        loadEvents();
    });
}

// Check URL search parameters (like auto-opening purchase modals or applying codes)
function checkQueryParameters() {
    const params = new URLSearchParams(window.location.search);
    const eventId = params.get('event');
    const promoCode = params.get('promo');

    if (eventId) {
        // Delay slightly to wait for events load
        setTimeout(() => {
            if (promoCode) {
                const buyPromo = document.getElementById('buy-promo-code');
                if (buyPromo) buyPromo.value = promoCode.toUpperCase();
            }
            openPurchaseFlow(eventId);
        }, 600);
    }
}


// ==========================================
// TICKET PURCHASE FLOW
// ==========================================
async function openPurchaseFlow(eventId) {
    const user = localStorage.getItem('user');
    if (!user) {
        showToast('Inicia sessão para poderes comprar bilhetes.', 'error');
        setTimeout(() => {
            window.location.href = `/login.html?event=${eventId}`;
        }, 1000);
        return;
    }

    try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        checkoutEventId = eventId;
        
        document.getElementById('modal-event-title').innerText = data.event.title;
        document.getElementById('modal-event-location').innerHTML = `<i class="fa-solid fa-location-dot"></i> ${data.event.location}`;
        document.getElementById('modal-event-price').innerText = `${parseFloat(data.event.ticket_price).toFixed(2)}€`;

        openModal('modal-buy-ticket');

    } catch (err) {
        console.error(err);
        showToast('Erro ao abrir checkout.', 'error');
    }
}

// Purchase Confirmation Button
const confirmPurchaseBtn = document.getElementById('btn-confirm-purchase');
if (confirmPurchaseBtn) {
    confirmPurchaseBtn.addEventListener('click', async () => {
        if (!checkoutEventId) return;

        const promoCode = document.getElementById('buy-promo-code').value.trim();

        try {
            confirmPurchaseBtn.disabled = true;
            confirmPurchaseBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> A processar...';

            const res = await fetch('/api/tickets/purchase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventId: checkoutEventId,
                    promoCode: promoCode || null
                })
            });

            const data = await res.json();

            if (!res.ok) {
                showToast(data.error || 'Erro na compra do bilhete.', 'error');
            } else {
                showToast(data.message || 'Bilhete adquirido com sucesso!', 'success');
                closeModal('modal-buy-ticket');
                document.getElementById('buy-promo-code').value = '';
                
                // Redirect to Client Vault
                setTimeout(() => {
                    window.location.href = '/my-area';
                }, 800);
            }
        } catch (err) {
            console.error(err);
            showToast('Falha na comunicação com o servidor.', 'error');
        } finally {
            confirmPurchaseBtn.disabled = false;
            confirmPurchaseBtn.innerHTML = '<i class="fa-solid fa-wallet"></i> Pagar com Carteira';
        }
    });
}


// ==========================================
// GUESTLIST REGISTER FLOW
// ==========================================
async function openGuestlistFlow(eventId) {
    const user = localStorage.getItem('user');
    if (!user) {
        showToast('Inicia sessão para poderes aderir a listas.', 'error');
        setTimeout(() => {
            window.location.href = `/login.html`;
        }, 1000);
        return;
    }

    try {
        const res = await fetch(`/api/events/${eventId}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        
        if (data.guestlists.length === 0) {
            showToast('Não existem GuestLists abertas para este evento.', 'error');
            return;
        }

        guestlistEventId = eventId;
        const gl = data.guestlists[0]; // grab the first active guestlist
        selectedGuestlistId = gl.id;

        document.getElementById('modal-gl-event-title').innerText = data.event.title;
        document.getElementById('modal-gl-name').innerText = gl.name;
        document.getElementById('modal-gl-conditions').innerHTML = `
            <strong>Preço / Restrições:</strong><br>
            ${gl.conditions || 'Condições normais da casa.'}<br><br>
            <strong>Lotação Limite:</strong> ${gl.max_capacity ? gl.max_capacity + ' pessoas' : 'Sem limite definido'}
        `;

        openModal('modal-join-gl');

    } catch (err) {
        console.error(err);
        showToast('Erro ao carregar detalhes da GuestList.', 'error');
    }
}

// Join Guestlist Confirmation Button
const confirmGlBtn = document.getElementById('btn-confirm-gl');
if (confirmGlBtn) {
    confirmGlBtn.addEventListener('click', async () => {
        if (!selectedGuestlistId) return;

        try {
            confirmGlBtn.disabled = true;
            confirmGlBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> A inscrever...';

            const res = await fetch('/api/tickets/join-gl', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestlistId: selectedGuestlistId })
            });

            const data = await res.json();

            if (!res.ok) {
                showToast(data.error || 'Erro ao aderir à GuestList.', 'error');
            } else {
                showToast(data.message || 'Adicionado à GuestList com sucesso!', 'success');
                closeModal('modal-join-gl');
                
                // Redirect to Client Vault
                setTimeout(() => {
                    window.location.href = '/my-area';
                }, 800);
            }
        } catch (err) {
            console.error(err);
            showToast('Erro ao registar na GuestList.', 'error');
        } finally {
            confirmGlBtn.disabled = false;
            confirmGlBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Confirmar Nome';
        }
    });
}
