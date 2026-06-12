import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { pocketMoneyService, fetchFundPrice } from '../services/pocketMoneyService';
import type { InvestmentOffer, Investment } from '../types';
import {
  Briefcase,
  Coins,
  TrendingUp,
  TrendingDown,
  Lock,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

interface ChildInvestmentsTabProps {
  offers: InvestmentOffer[];
  investments: Investment[];
  prices: Record<string, number>;
  currentTime: number;
  updatePrice: (ticker: string, price: number) => void;
}

export const ChildInvestmentsTab: React.FC<ChildInvestmentsTabProps> = ({
  offers,
  investments,
  prices,
  currentTime,
  updatePrice
}) => {
  const { user, refreshUser } = useAuth();

  // Modals state
  const [selectedOffer, setSelectedOffer] = useState<InvestmentOffer | null>(null);
  const [investAmount, setInvestAmount] = useState('');
  const [investError, setInvestError] = useState<string | null>(null);
  const [investSuccess, setInvestSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sell modal states
  const [selectedInvForSell, setSelectedInvForSell] = useState<(Investment & {
    currentValue: number;
    profit: number;
    profitPercent: number;
    remainingDays?: number;
    currentPrice?: number;
  }) | null>(null);
  const [sellType, setSellType] = useState<'all' | 'part'>('all');
  const [sellAmount, setSellAmount] = useState('');
  const [sellError, setSellError] = useState<string | null>(null);
  const [sellSuccess, setSellSuccess] = useState(false);

  // Calculate current value of active investments
  const activeInvestmentsDetails = useMemo(() => {
    return investments.map(inv => {
      if (inv.status !== 'active') return null;

      if (inv.type === 'festgeld') {
        const remainingDays = Math.max(0, Math.ceil(((inv.endDate || 0) - currentTime) / (1000 * 60 * 60 * 24)));
        return {
          ...inv,
          currentValue: inv.amountInvested, // Festgeld value is stable until maturity
          profit: 0,
          profitPercent: 0,
          remainingDays
        };
      } else {
        // Aktienfonds
        const currentPrice = prices[inv.tickerSymbol || ''] || inv.buyPrice || 1;
        const currentValue = Number(((inv.sharesOwned || 0) * currentPrice).toFixed(2));
        const profit = Number((currentValue - inv.amountInvested).toFixed(2));
        const profitPercent = inv.amountInvested > 0 ? (profit / inv.amountInvested) * 100 : 0;

        return {
          ...inv,
          currentPrice,
          currentValue,
          profit,
          profitPercent
        };
      }
    }).filter(Boolean) as Array<Investment & {
      currentValue: number;
      profit: number;
      profitPercent: number;
      remainingDays?: number;
      currentPrice?: number;
    }>;
  }, [investments, prices, currentTime]);

  // Total portfolio value & stats
  const portfolioStats = useMemo(() => {
    let activeValue = 0;
    let totalInvested = 0;
    let stockProfit = 0;

    activeInvestmentsDetails.forEach(inv => {
      activeValue += inv.currentValue;
      totalInvested += inv.amountInvested;
      if (inv.type === 'aktienfonds') {
        stockProfit += inv.profit;
      }
    });

    const netWorth = (user?.balance || 0) + activeValue;
    const overallProfitPercent = totalInvested > 0 ? (stockProfit / totalInvested) * 100 : 0;

    return {
      portfolioValue: activeValue,
      totalInvested,
      stockProfit,
      overallProfitPercent,
      netWorth
    };
  }, [activeInvestmentsDetails, user?.balance]);

  const currencySymbol = user?.currency === 'USD' ? '$' : user?.currency === 'CHF' ? 'CHF' : '€';

  const handleOpenInvest = (offer: InvestmentOffer) => {
    setSelectedOffer(offer);
    setInvestAmount('');
    setInvestError(null);
    setInvestSuccess(false);

    // Auto-fill price in case child invests in stock
    if (offer.type === 'aktienfonds' && offer.tickerSymbol) {
      const price = prices[offer.tickerSymbol] || 0;
      if (price === 0) {
        // Fetch price immediately
        fetchFundPrice(offer.tickerSymbol, user?.twelveDataApiKey).then(p => {
          updatePrice(offer.tickerSymbol!, p);
        });
      }
    }

    const dialog = document.getElementById('invest-dialog') as HTMLDialogElement | null;
    dialog?.showModal();
  };

  const handleCloseInvest = () => {
    const dialog = document.getElementById('invest-dialog') as HTMLDialogElement | null;
    dialog?.close();
    setSelectedOffer(null);
  };

  const handleInvestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInvestError(null);
    setInvestSuccess(false);

    if (!selectedOffer || !user) return;

    const amount = parseFloat(investAmount);
    if (isNaN(amount) || amount <= 0) {
      setInvestError('Bitte gib einen gültigen Betrag ein.');
      return;
    }
    if (amount > user.balance) {
      setInvestError(`Du hast nicht genug Geld auf deinem Konto. (Max: ${user.balance.toFixed(2)} ${currencySymbol})`);
      return;
    }

    setSubmitting(true);

    const baseInvestment = {
      userId: user.uid,
      offerId: selectedOffer.id,
      name: selectedOffer.name,
      type: selectedOffer.type,
      currency: user.currency,
      amountInvested: amount,
      startDate: Date.now(),
      status: 'active' as const
    };

    let finalInv: Omit<Investment, 'id'>;

    if (selectedOffer.type === 'festgeld') {
      const rate = selectedOffer.interestRate || 0;
      const duration = selectedOffer.durationMonths || 6;
      const endDate = Date.now() + duration * 30 * 24 * 60 * 60 * 1000; // rough 30 days per month
      const interestEarned = amount * rate * (duration / 12);
      const amountMatured = Number((amount + interestEarned).toFixed(2));

      finalInv = {
        ...baseInvestment,
        interestRate: rate,
        durationMonths: duration,
        endDate,
        amountMatured
      };
    } else {
      // Aktienfonds
      const currentPrice = prices[selectedOffer.tickerSymbol || ''] || 100; // fallback
      const sharesOwned = amount / currentPrice;

      finalInv = {
        ...baseInvestment,
        tickerSymbol: selectedOffer.tickerSymbol,
        categoryName: selectedOffer.categoryName,
        buyPrice: currentPrice,
        sharesOwned
      };
    }

    try {
      await pocketMoneyService.createInvestment(finalInv);
      setInvestSuccess(true);
      await refreshUser();
      setTimeout(() => {
        handleCloseInvest();
      }, 1500);
    } catch (err: unknown) {
      console.error(err);
      setInvestError(err instanceof Error ? err.message : 'Fehler beim Investieren.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenSell = (inv: any) => {
    setSelectedInvForSell(inv);
    setSellType('all');
    setSellAmount('');
    setSellError(null);
    setSellSuccess(false);

    const dialog = document.getElementById('sell-dialog') as HTMLDialogElement | null;
    dialog?.showModal();
  };

  const handleCloseSell = () => {
    const dialog = document.getElementById('sell-dialog') as HTMLDialogElement | null;
    dialog?.close();
    setSelectedInvForSell(null);
  };

  const handleSellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSellError(null);
    setSellSuccess(false);

    if (!selectedInvForSell || !user) return;

    const currentPrice = selectedInvForSell.currentPrice;
    if (!currentPrice) {
      setSellError('Kurspreis konnte nicht ermittelt werden.');
      return;
    }

    const sellAll = sellType === 'all';
    let sharesToSell = selectedInvForSell.sharesOwned || 0;

    if (!sellAll) {
      const amt = parseFloat(sellAmount);
      if (isNaN(amt) || amt <= 0) {
        setSellError('Bitte gib einen gültigen Betrag ein.');
        return;
      }

      sharesToSell = amt / currentPrice;

      if (sharesToSell > (selectedInvForSell.sharesOwned || 0)) {
        setSellError(`Du kannst maximal ${selectedInvForSell.sharesOwned?.toFixed(4)} Anteile (Wert: ${selectedInvForSell.currentValue.toFixed(2)} ${currencySymbol}) verkaufen.`);
        return;
      }

      // Clamp to total shares if within 0.00001 or if amount matches total value closely
      if (Math.abs(sharesToSell - (selectedInvForSell.sharesOwned || 0)) < 0.00001 || amt >= selectedInvForSell.currentValue - 0.01) {
        sharesToSell = selectedInvForSell.sharesOwned || 0;
      }
    }

    setSubmitting(true);

    try {
      const isCompleteSell = sellAll || sharesToSell === selectedInvForSell.sharesOwned;
      await pocketMoneyService.sellInvestment(
        selectedInvForSell.id,
        currentPrice,
        isCompleteSell ? undefined : sharesToSell
      );
      
      setSellSuccess(true);
      await refreshUser();
      setTimeout(() => {
        handleCloseSell();
      }, 1500);
    } catch (err: unknown) {
      console.error(err);
      setSellError(err instanceof Error ? err.message : 'Fehler beim Auszahlen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

      {/* Portfolio overview row */}
      <div className="grid-3">

        {/* Total Net Worth */}
        <div className="glass-panel p-2 text-center" style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, var(--bg-surface), var(--color-primary-glow))'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Gesamtguthaben
          </span>
          <h2 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0.5rem 0', color: 'var(--text-primary)' }}>
            {portfolioStats.netWorth.toFixed(2)} {currencySymbol}
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Wallet + Geldanlage
          </span>
        </div>

        {/* Wallet Cash */}
        <div className="glass-panel p-2 text-center" style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Mein Portemonnaie
          </span>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 800, margin: '0.5rem 0', color: 'var(--color-primary)' }}>
            {user?.balance.toFixed(2)} {currencySymbol}
          </h2>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Sofort auszugeben
          </span>
        </div>

        {/* Portfolio investments value */}
        <div className="glass-panel p-2 text-center" style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, var(--bg-surface), var(--color-success-bg))'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Meine Geldanlagen
          </span>
          <h2 style={{ fontSize: '2.2rem', fontWeight: 800, margin: '0.5rem 0', color: 'var(--color-success)' }}>
            {portfolioStats.portfolioValue.toFixed(2)} {currencySymbol}
          </h2>
          <div className="flex-align-center" style={{ justifyContent: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
            {portfolioStats.stockProfit >= 0 ? (
              <span style={{ color: 'var(--color-success)', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                <ArrowUpRight size={14} /> +{portfolioStats.stockProfit.toFixed(2)} {currencySymbol} ({portfolioStats.overallProfitPercent.toFixed(1)}%)
              </span>
            ) : (
              <span style={{ color: 'var(--color-danger)', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                <ArrowDownRight size={14} /> {portfolioStats.stockProfit.toFixed(2)} {currencySymbol} ({portfolioStats.overallProfitPercent.toFixed(1)}%)
              </span>
            )}
          </div>
        </div>

      </div>

      {/* Child Portfolio list */}
      <div className="glass-panel p-2">
        <h3 className="form-label" style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Briefcase size={20} className="text-primary" />
          Meine laufenden Anlagen ({activeInvestmentsDetails.length})
        </h3>

        {activeInvestmentsDetails.length === 0 ? (
          <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            <p>Du hast derzeit kein Geld angelegt.</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              Schau dir unten die verfügbaren Angebote an und investiere einen Teil deines Taschengelds, um Zinsen zu verdienen!
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {activeInvestmentsDetails.map(inv => {
              const isFestgeld = inv.type === 'festgeld';

              return (
                <div
                  key={inv.id}
                  className="glass-panel p-2"
                  style={{
                    background: 'rgba(255, 255, 255, 0.015)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    position: 'relative'
                  }}
                >
                  <div>
                    {/* Header */}
                    <div className="flex-between">
                      <span className="badge" style={{
                        background: isFestgeld ? 'var(--color-primary-glow)' : 'var(--color-success-bg)',
                        color: isFestgeld ? 'var(--color-primary)' : 'var(--color-success)',
                        fontSize: '0.65rem'
                      }}>
                        {isFestgeld ? 'Festgeld' : 'Aktienfonds'}
                      </span>
                      {!isFestgeld && inv.categoryName && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                          {inv.categoryName}
                        </span>
                      )}
                    </div>

                    <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0.75rem 0 0.5rem 0' }}>{inv.name}</h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
                      <div className="flex-between">
                        <span style={{ color: 'var(--text-secondary)' }}>Eingezahlt:</span>
                        <strong style={{ color: 'var(--text-primary)' }}>{inv.amountInvested.toFixed(2)} {currencySymbol}</strong>
                      </div>

                      {isFestgeld ? (
                        <>
                          <div className="flex-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Zinssatz:</span>
                            <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>{((inv.interestRate || 0) * 100).toFixed(1)}% p.a.</span>
                          </div>
                          <div className="flex-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Auszahlung:</span>
                            <strong style={{ color: 'var(--color-success)' }}>{inv.amountMatured?.toFixed(2)} {currencySymbol}</strong>
                          </div>
                          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.25rem 0' }} />
                          <div className="flex-align-center" style={{ color: 'var(--color-warning)', fontWeight: 600, fontSize: '0.8rem', gap: '0.35rem' }}>
                            <Lock size={14} />
                            <span>Gesperrt: Noch {inv.remainingDays} Tage</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Kurs beim Kauf:</span>
                            <span>{inv.buyPrice?.toFixed(2)} {currencySymbol}</span>
                          </div>
                          <div className="flex-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Aktueller Kurs:</span>
                            <strong>{inv.currentPrice?.toFixed(2)} {currencySymbol}</strong>
                          </div>
                          <div className="flex-between">
                            <span style={{ color: 'var(--text-secondary)' }}>Aktueller Wert:</span>
                            <strong style={{ color: 'var(--text-primary)' }}>{inv.currentValue.toFixed(2)} {currencySymbol}</strong>
                          </div>
                          <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.25rem 0' }} />
                          <div className="flex-between" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
                            <span style={{ color: 'var(--text-secondary)' }}>Gewinn/Verlust:</span>
                            {inv.profit >= 0 ? (
                              <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                <TrendingUp size={14} /> +{inv.profit.toFixed(2)} {currencySymbol} (+{inv.profitPercent.toFixed(1)}%)
                              </span>
                            ) : (
                              <span style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                                <TrendingDown size={14} /> {inv.profit.toFixed(2)} {currencySymbol} ({inv.profitPercent.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {!isFestgeld && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        fontSize: '0.85rem',
                        marginTop: '0.5rem',
                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-success))',
                        color: 'var(--bg-primary)'
                      }}
                      onClick={() => handleOpenSell(inv)}
                    >
                      Verkaufen & Auszahlen
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available offers list */}
      <div className="glass-panel p-2">
        <h3 className="form-label" style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Coins size={20} className="text-primary" />
          Verfügbare Anlage-Angebote ({offers.length})
        </h3>

        {offers.length === 0 ? (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <p>Deine Eltern haben noch keine Anlageangebote für dich freigeschaltet.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            {offers.map(offer => {
              const isFestgeld = offer.type === 'festgeld';
              const tickerPrice = !isFestgeld && offer.tickerSymbol ? prices[offer.tickerSymbol] : null;

              return (
                <div
                  key={offer.id}
                  className="glass-panel p-2 glass-panel-interactive"
                  style={{
                    background: 'rgba(255, 255, 255, 0.01)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '1rem'
                  }}
                >
                  <div>
                    {/* Header */}
                    <div className="flex-between">
                      <span className="badge" style={{
                        background: isFestgeld ? 'var(--color-primary-glow)' : 'var(--color-success-bg)',
                        color: isFestgeld ? 'var(--color-primary)' : 'var(--color-success)',
                        fontSize: '0.65rem'
                      }}>
                        {isFestgeld ? 'Festgeld' : 'Aktienfonds'}
                      </span>
                      {!isFestgeld && offer.categoryName && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {offer.categoryName}
                        </span>
                      )}
                    </div>

                    <h4 style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0.75rem 0 0.5rem 0' }}>{offer.name}</h4>

                    {isFestgeld ? (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        <p>Zinsen: <strong style={{ color: 'var(--color-success)' }}>{((offer.interestRate || 0) * 100).toFixed(1)}% pro Jahr</strong></p>
                        <p>Festgelegt für: <strong style={{ color: 'var(--text-primary)' }}>{offer.durationMonths} {offer.durationMonths === 1 ? 'Monat' : 'Monate'}</strong></p>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '0.5rem' }}>
                          💡 Dein Geld wird für die Dauer der Laufzeit gesperrt. Bei Fälligkeit bekommst du dein Geld und die Zinsen bar ausgezahlt.
                        </p>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        <p>Aktueller Anteilspreis: <strong style={{ color: 'var(--color-primary)' }}>{typeof tickerPrice === 'number' ? `${tickerPrice.toFixed(2)} ${currencySymbol}` : 'lädt...'}</strong></p>
                        {offer.description && (
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                            {offer.description}
                          </p>
                        )}
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '0.5rem' }}>
                          💡 Beliebiger Betrag. Du kaufst Anteile zum aktuellen Kurs und kannst diese jederzeit wieder verkaufen. Achtung: Der Kurs kann steigen oder fallen!
                        </p>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%' }}
                    onClick={() => handleOpenInvest(offer)}
                  >
                    {isFestgeld ? 'Festgeld anlegen' : 'In Fonds investieren'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invest Modal Dialog */}
      <dialog id="invest-dialog" className="modal">
        {selectedOffer && (
          <form onSubmit={handleInvestSubmit} className="modal-content" style={{ padding: '2rem' }}>
            <div className="modal-header">
              <h3 className="modal-title">Geld anlegen</h3>
              <button type="button" className="btn btn-secondary btn-icon-only" onClick={handleCloseInvest}>×</button>
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <p>Du investierst in: <strong>{selectedOffer.name}</strong></p>
              <p>Verfügbares Taschengeld: <strong>{user?.balance.toFixed(2)} {currencySymbol}</strong></p>
              {selectedOffer.type === 'aktienfonds' && selectedOffer.tickerSymbol && (
                <p>Aktueller Kurs: <strong>{(prices[selectedOffer.tickerSymbol] || 100).toFixed(2)} {currencySymbol} / Anteil</strong></p>
              )}
            </div>

            {investError && (
              <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 500, border: '1px solid rgba(255, 0, 85, 0.2)' }}>
                {investError}
              </div>
            )}
            {investSuccess && (
              <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 500, border: '1px solid rgba(0, 255, 102, 0.2)' }}>
                ✓ Anlage erfolgreich getätigt!
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="invest-amount-input">Anlagebetrag ({currencySymbol})</label>
              <input
                id="invest-amount-input"
                type="number"
                step="0.01"
                min="0.01"
                max={user?.balance || 0}
                className="form-input"
                placeholder="Betrag eingeben"
                value={investAmount}
                onChange={(e) => setInvestAmount(e.target.value)}
                required
                disabled={submitting || investSuccess}
              />
              {selectedOffer.type === 'festgeld' && selectedOffer.interestRate && selectedOffer.durationMonths && investAmount && (
                <div style={{ marginTop: '0.5rem', background: 'var(--border-color)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.8rem' }}>
                  Auszahlung nach {selectedOffer.durationMonths} Monaten:{' '}
                  <strong>
                    {(parseFloat(investAmount || '0') * (1 + selectedOffer.interestRate * (selectedOffer.durationMonths / 12)) || 0).toFixed(2)}{' '}
                    {currencySymbol}
                  </strong>{' '}
                  (inkl. {((selectedOffer.interestRate || 0) * 100).toFixed(1)}% Zins p.a.)
                </div>
              )}
              {selectedOffer.type === 'aktienfonds' && selectedOffer.tickerSymbol && investAmount && (
                <div style={{ marginTop: '0.5rem', background: 'var(--border-color)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.8rem' }}>
                  Geschätzter Erwerb:{' '}
                  <strong>
                    {(parseFloat(investAmount || '0') / (prices[selectedOffer.tickerSymbol] || 1)).toFixed(4)} Anteile
                  </strong>
                </div>
              )}
            </div>

            <div className="flex-align-center" style={{ justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={handleCloseInvest} disabled={submitting || investSuccess}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || investSuccess}>
                {submitting ? 'Wird verbucht...' : 'Geld anlegen'}
              </button>
            </div>
          </form>
        )}
      </dialog>

      {/* Sell Modal Dialog */}
      <dialog id="sell-dialog" className="modal">
        {selectedInvForSell && (
          <form onSubmit={handleSellSubmit} className="modal-content" style={{ padding: '2rem' }}>
            <div className="modal-header">
              <h3 className="modal-title">Geld auszahlen</h3>
              <button type="button" className="btn btn-secondary btn-icon-only" onClick={handleCloseSell}>×</button>
            </div>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <p>Du verkaufst Anteile von: <strong>{selectedInvForSell.name}</strong></p>
              <p>Aktueller Kurs: <strong>{(selectedInvForSell.currentPrice || 0).toFixed(2)} {currencySymbol} / Anteil</strong></p>
              <p>Besitz insgesamt: <strong>{(selectedInvForSell.sharesOwned || 0).toFixed(4)} Anteile</strong> (Wert: <strong>{selectedInvForSell.currentValue.toFixed(2)} {currencySymbol}</strong>)</p>
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label">Auszahlungs-Art</label>
              <div style={{ display: 'flex', background: 'var(--border-color)', padding: '4px', borderRadius: '10px', marginBottom: '1rem' }}>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    background: sellType === 'all' ? 'var(--color-primary-glow)' : 'transparent',
                    color: sellType === 'all' ? 'var(--color-primary)' : 'var(--text-secondary)',
                    borderRadius: '8px',
                    padding: '0.45rem',
                    fontSize: '0.85rem'
                  }}
                  onClick={() => {
                    setSellType('all');
                    setSellAmount('');
                    setSellError(null);
                  }}
                  disabled={submitting || sellSuccess}
                >
                  Ganz auszahlen ({selectedInvForSell.currentValue.toFixed(2)} {currencySymbol})
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    background: sellType === 'part' ? 'var(--color-primary-glow)' : 'transparent',
                    color: sellType === 'part' ? 'var(--color-primary)' : 'var(--text-secondary)',
                    borderRadius: '8px',
                    padding: '0.45rem',
                    fontSize: '0.85rem'
                  }}
                  onClick={() => {
                    setSellType('part');
                    setSellAmount('');
                    setSellError(null);
                  }}
                  disabled={submitting || sellSuccess}
                >
                  Teilbetrag auszahlen
                </button>
              </div>
            </div>

            {sellType === 'part' && (
              <div className="form-group" style={{ animation: 'fadeIn 0.25s ease' }}>
                <label className="form-label" htmlFor="sell-amount-input">Auszahlungsbetrag ({currencySymbol})</label>
                <input
                  id="sell-amount-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={selectedInvForSell.currentValue}
                  className="form-input"
                  placeholder="Betrag eingeben"
                  value={sellAmount}
                  onChange={(e) => {
                    setSellAmount(e.target.value);
                    setSellError(null);
                  }}
                  required
                  disabled={submitting || sellSuccess}
                />
                {sellAmount && !isNaN(parseFloat(sellAmount)) && (
                  <div style={{ marginTop: '0.5rem', background: 'var(--border-color)', padding: '0.5rem', borderRadius: '8px', fontSize: '0.8rem' }}>
                    Entspricht dem Verkauf von:{' '}
                    <strong>
                      {(parseFloat(sellAmount) / (selectedInvForSell.currentPrice || 1)).toFixed(4)} Anteilen
                    </strong>
                  </div>
                )}
              </div>
            )}

            {sellError && (
              <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 500, border: '1px solid rgba(255, 0, 85, 0.2)', marginTop: '1rem' }}>
                {sellError}
              </div>
            )}
            {sellSuccess && (
              <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', padding: '0.75rem', borderRadius: '10px', fontSize: '0.85rem', fontWeight: 500, border: '1px solid rgba(0, 255, 102, 0.2)', marginTop: '1rem' }}>
                ✓ Auszahlung erfolgreich getätigt!
              </div>
            )}

            <div className="flex-align-center" style={{ justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" className="btn btn-secondary" onClick={handleCloseSell} disabled={submitting || sellSuccess}>
                Abbrechen
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting || sellSuccess}>
                {submitting ? 'Auszahlung läuft...' : 'Verkaufen & Auszahlen'}
              </button>
            </div>
          </form>
        )}
      </dialog>

    </div>
  );
};
