import React, { useMemo, useEffect, useRef, useState } from 'react';
import type { Transaction, UserProfile, Investment } from '../types';
import { useTheme } from '../context/ThemeContext';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

// Register Chart.js components
Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface PocketMoneyChartProps {
  child: UserProfile;
  transactions: Transaction[];
  currencySymbol: string;
  investments?: Investment[];
  prices?: Record<string, number>;
}

export const PocketMoneyChart: React.FC<PocketMoneyChartProps> = ({ 
  child, 
  transactions, 
  currencySymbol,
  investments = [],
  prices = {}
}) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  // 1. SELECTABLE PROJECTION TIMEFRAME STATE (in days)
  const [projectionDays, setProjectionDays] = useState<number>(90);

  // 2. STABLE 'NOW' TIMESTAMP ON MOUNT (prevents millisecond drifts on every render)
  const [now] = useState(() => Date.now());

  // 3. DATA SIGNATURES TO PREVENT POLL-TRIGGERED RE-CALCULATIONS
  const txsSignature = useMemo(() => {
    return transactions.map(t => `${t.id}-${t.amount}-${t.date}`).join(',');
  }, [transactions]);

  const allowancesSignature = useMemo(() => {
    return JSON.stringify(child.allowances || []);
  }, [child.allowances]);

  const investmentsSignature = useMemo(() => {
    return (investments || [])
      .filter(i => i.status === 'active')
      .map(i => `${i.id}-${i.type}-${i.amountInvested || i.amountMatured || 0}-${i.endDate || i.startDate || 0}-${i.sharesOwned || 0}`)
      .join(',');
  }, [investments]);

  const pricesSignature = useMemo(() => {
    return JSON.stringify(prices || {});
  }, [prices]);

  // 4. MEMOIZED CHART DATA
  const chartData = useMemo(() => {
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const projectionDaysHence = now + projectionDays * 24 * 60 * 60 * 1000;

    // A. RECONSTRUCT PAST DATA (last 30 days)
    let tempBalance = child.balance;
    const pastPoints: { date: number; balance: number; isFuture: boolean }[] = [
      { date: now, balance: tempBalance, isFuture: false }
    ];

    // Read transactions from newest (index 0) to oldest to reconstruct history backwards
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.date < thirtyDaysAgo) break;
      tempBalance = Number((tempBalance - tx.amount).toFixed(2));
      pastPoints.unshift({ date: tx.date, balance: tempBalance, isFuture: false });
    }

    // Ensure we have at least one starting point 30 days ago
    if (pastPoints.length > 0 && pastPoints[0].date > thirtyDaysAgo) {
      pastPoints.unshift({ date: thirtyDaysAgo, balance: pastPoints[0].balance, isFuture: false });
    }

    // B. PROJECT FUTURE DATA (next projectionDays)
    const futurePoints: { date: number; balance: number; investments: number; total: number; isFuture: boolean }[] = [];

    const INTERVAL_MS = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      biweekly: 14 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    // Calculate daily return rate for each active stock fund
    const stockRates = (investments || [])
      .filter(inv => inv.status === 'active' && inv.type === 'aktienfonds')
      .map(inv => {
        const currentPrice = prices[inv.tickerSymbol || ''] || inv.buyPrice || 1;
        const elapsedMs = now - inv.startDate;
        const elapsedDays = Math.max(0, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)));
        let rDaily = 0.00021; // Default rate ~ 8% p.a.
        if (elapsedDays >= 1 && inv.buyPrice && inv.buyPrice > 0) {
          const historicalReturn = (currentPrice - inv.buyPrice) / inv.buyPrice;
          const calculatedRate = Math.pow(1 + historicalReturn, 1 / elapsedDays) - 1;
          rDaily = Math.max(-0.0005, Math.min(0.0008, calculatedRate));
        }
        return {
          id: inv.id,
          shares: inv.sharesOwned || 0,
          currentPrice,
          rDaily
        };
      });

    // We generate points daily from 0 to projectionDays
    for (let d = 0; d <= projectionDays; d++) {
      const targetDate = now + d * 24 * 60 * 60 * 1000;
      let cashVal = child.balance;
      let invVal = 0;

      // 1. Add allowance payouts up to targetDate
      if (child.allowances && child.allowances.length > 0) {
        child.allowances.forEach(allowance => {
          const intervalMs = INTERVAL_MS[allowance.interval];
          let nextTime = (allowance.lastCreditTimestamp || now) + intervalMs;
          while (nextTime <= targetDate) {
            cashVal += allowance.amount;
            nextTime += intervalMs;
          }
        });
      }

      // 2. Add investment values at targetDate
      if (investments && investments.length > 0) {
        investments.forEach(inv => {
          if (inv.status !== 'active') return;

          if (inv.type === 'festgeld') {
            if (inv.endDate && inv.amountMatured) {
              if (inv.endDate <= targetDate) {
                // Matured and moved to cash
                cashVal += inv.amountMatured;
              } else {
                // Still active investment
                invVal += inv.amountMatured;
              }
            }
          }
        });
      }

      // Add projected stock fund values
      stockRates.forEach(stock => {
        const projectedPrice = stock.currentPrice * Math.pow(1 + stock.rDaily, d);
        invVal += Number((stock.shares * projectedPrice).toFixed(2));
      });

      futurePoints.push({
        date: targetDate,
        balance: Number(cashVal.toFixed(2)),
        investments: Number(invVal.toFixed(2)),
        total: Number((cashVal + invVal).toFixed(2)),
        isFuture: true
      });
    }

    return {
      pastPoints,
      futurePoints,
      minDate: thirtyDaysAgo,
      maxDate: projectionDaysHence
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.uid, child.balance, allowancesSignature, txsSignature, now, projectionDays, investmentsSignature, pricesSignature]);

  const { pastPoints, futurePoints, minDate, maxDate } = chartData;

  // Formatting helpers
  const formatDateLabel = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  };

  // Separate useEffect to handle ChartJS cleanup ONLY on unmount
  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  // 5. INITIALIZE AND CONFIGURE CHART.JS
  useEffect(() => {

    const updateChart = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Dynamically retrieve CSS colors from the DOM
      const style = getComputedStyle(document.documentElement);
      const primaryColor = style.getPropertyValue('--color-primary').trim() || '#6366f1';
      const successColor = style.getPropertyValue('--color-success').trim() || '#10b981';
      const textColor = style.getPropertyValue('--text-secondary').trim() || '#94a3b8';
      const gridColor = style.getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.08)';
      const fontPrimary = style.getPropertyValue('--font-primary').trim() || 'Outfit';

      // Gradients for fill
      const pastGradient = ctx.createLinearGradient(0, 0, 0, 220);
      pastGradient.addColorStop(0, primaryColor + '40'); // 25% opacity
      pastGradient.addColorStop(1, primaryColor + '00'); // 0% opacity

      const futureGradient = ctx.createLinearGradient(0, 0, 0, 220);
      futureGradient.addColorStop(0, successColor + '25'); // 15% opacity
      futureGradient.addColorStop(1, successColor + '00'); // 0% opacity

      const currentInvestments = (investments || [])
        .filter(i => i.status === 'active')
        .reduce((sum, inv) => {
          const isFestgeld = inv.type === 'festgeld';
          const currentPrice = isFestgeld ? 0 : (prices?.[inv.tickerSymbol || ''] || inv.buyPrice || 1);
          return sum + (isFestgeld ? inv.amountInvested : (inv.sharesOwned || 0) * currentPrice);
        }, 0);
      const totalWealth = child.balance + currentInvestments;

      // If chart already exists, just update data and properties to prevent entry animation loops!
      if (chartInstanceRef.current) {
        const chart = chartInstanceRef.current;
        
        chart.data.datasets[0].data = pastPoints.map(p => ({ x: p.date, y: p.balance }));
        chart.data.datasets[0].backgroundColor = pastGradient;
        chart.data.datasets[0].borderColor = primaryColor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.data.datasets[0] as any).pointBackgroundColor = primaryColor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.data.datasets[0] as any).stepped = 'before';
        
        chart.data.datasets[1].data = futurePoints.map(p => ({ x: p.date, y: p.balance }));
        chart.data.datasets[1].backgroundColor = futureGradient;
        chart.data.datasets[1].borderColor = successColor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.data.datasets[1] as any).pointBackgroundColor = successColor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.data.datasets[1] as any).stepped = 'after';

        if (chart.data.datasets[2]) {
          chart.data.datasets[2].data = futurePoints.map(p => ({ x: p.date, y: p.total }));
          chart.data.datasets[2].backgroundColor = primaryColor + '18'; // 9% opacity glow
          chart.data.datasets[2].borderColor = primaryColor;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chart.data.datasets[2] as any).pointBackgroundColor = primaryColor;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (chart.data.datasets[2] as any).stepped = 'after';
        }
        
        chart.options.scales!.x!.min = minDate;
        chart.options.scales!.x!.max = maxDate;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.options.scales!.x!.ticks as any).stepSize = (maxDate - minDate) / 4;
        
        // Update scales styles for theme changes
        chart.options.scales!.x!.ticks!.color = textColor;
        chart.options.scales!.y!.ticks!.color = textColor;
        chart.options.scales!.y!.grid!.color = gridColor;

        if (chart.options.plugins?.tooltip) {
          chart.options.plugins.tooltip.backgroundColor = style.getPropertyValue('--bg-surface-opaque').trim() || 'rgba(17, 25, 40, 0.95)';
          chart.options.plugins.tooltip.titleColor = style.getPropertyValue('--text-primary').trim() || '#fff';
          chart.options.plugins.tooltip.bodyColor = style.getPropertyValue('--text-secondary').trim() || '#94a3b8';
          chart.options.plugins.tooltip.borderColor = gridColor;
        }
        
        chart.update();
        return;
      }

      // Custom Today Line Plugin
      const todayLinePlugin = {
        id: 'todayLine',
        afterDatasetsDraw(chart: Chart) {
          const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
          const xPos = x.getPixelForValue(now);

          if (xPos >= x.left && xPos <= x.right) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = primaryColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.moveTo(xPos, top);
            ctx.lineTo(xPos, bottom);
            ctx.stroke();

            // Label "Heute" at the top
            ctx.fillStyle = primaryColor;
            ctx.font = `bold 11px ${fontPrimary}`;
            ctx.textAlign = 'center';
            ctx.fillText('Heute', xPos, top - 8);

            // Node at the intersection of "Today" and current balance
            const yPosCash = chart.scales.y.getPixelForValue(child.balance);
            ctx.beginPath();
            ctx.fillStyle = style.getPropertyValue('--bg-surface-opaque').trim() || '#fff';
            ctx.strokeStyle = successColor;
            ctx.lineWidth = 3;
            ctx.arc(xPos, yPosCash, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();

            if (currentInvestments > 0) {
              const yPosTotal = chart.scales.y.getPixelForValue(totalWealth);

              // Connect cash node to total node
              ctx.beginPath();
              ctx.strokeStyle = primaryColor;
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 2]);
              ctx.moveTo(xPos, yPosCash);
              ctx.lineTo(xPos, yPosTotal);
              ctx.stroke();

              // Total wealth node
              ctx.beginPath();
              ctx.fillStyle = style.getPropertyValue('--bg-surface-opaque').trim() || '#fff';
              ctx.strokeStyle = primaryColor;
              ctx.lineWidth = 3;
              ctx.arc(xPos, yPosTotal, 5, 0, 2 * Math.PI);
              ctx.fill();
              ctx.stroke();
            }

            ctx.restore();
          }
        }
      };

      // Instantiate Chart
      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        plugins: [todayLinePlugin],
        data: {
          datasets: [
            {
              label: 'Historischer Verlauf',
              data: pastPoints.map(p => ({ x: p.date, y: p.balance })),
              borderColor: primaryColor,
              backgroundColor: pastGradient,
              borderWidth: 3.5,
              tension: 0,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHitRadius: 10,
              pointBackgroundColor: primaryColor,
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
              stepped: 'before'
            },
            {
              label: 'Frei verfügbares Guthaben (Prognose)',
              data: futurePoints.map(p => ({ x: p.date, y: p.balance })),
              borderColor: successColor,
              backgroundColor: futureGradient,
              borderWidth: 3,
              borderDash: [6, 6],
              tension: 0,
              fill: true,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHitRadius: 10,
              pointBackgroundColor: successColor,
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
              stepped: 'after'
            },
            {
              label: 'Gesamtvermögen (Prognose)',
              data: futurePoints.map(p => ({ x: p.date, y: p.total })),
              borderColor: primaryColor,
              backgroundColor: primaryColor + '18', // Very light primary glow between cash and total
              borderWidth: 3,
              tension: 0,
              fill: 1, // Fill to dataset index 1 (Frei verfügbares Guthaben)
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHitRadius: 10,
              pointBackgroundColor: primaryColor,
              pointBorderColor: '#fff',
              pointBorderWidth: 2,
              stepped: 'after'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 20
            }
          },
          scales: {
            x: {
              type: 'linear',
              min: minDate,
              max: maxDate,
              ticks: {
                stepSize: (maxDate - minDate) / 4,
                color: textColor,
                font: {
                  family: fontPrimary,
                  size: 11,
                  weight: 600
                },
                callback: (value: number | string) => formatDateLabel(Number(value))
              },
              grid: {
                display: false
              }
            },
            y: {
              type: 'linear',
              ticks: {
                color: textColor,
                font: {
                  family: fontPrimary,
                  size: 11,
                  weight: 600
                },
                callback: (value: number | string) => `${Number(value).toFixed(0)} ${currencySymbol}`
              },
              grid: {
                color: gridColor,
                lineWidth: 1,
                tickBorderDash: [4, 8]
              }
            }
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              backgroundColor: style.getPropertyValue('--bg-surface-opaque').trim() || 'rgba(17, 25, 40, 0.95)',
              titleColor: style.getPropertyValue('--text-primary').trim() || '#fff',
              bodyColor: style.getPropertyValue('--text-secondary').trim() || '#94a3b8',
              borderColor: gridColor,
              borderWidth: 1,
              padding: 12,
              cornerRadius: 12,
              titleFont: {
                family: fontPrimary,
                size: 12,
                weight: 'bold'
              },
              bodyFont: {
                family: fontPrimary,
                size: 12,
                weight: 600
              },
              callbacks: {
                title: (items) => {
                  if (items.length > 0 && items[0].parsed.x !== null && items[0].parsed.x !== undefined) {
                    return formatDateLabel(items[0].parsed.x);
                  }
                  return '';
                },
                label: (item) => {
                  const yVal = item.parsed.y ?? 0;
                  const val = yVal.toFixed(2);
                  if (item.datasetIndex === 2) {
                    const cashVal = item.chart.data.datasets[1].data[item.dataIndex]
                      ? (item.chart.data.datasets[1].data[item.dataIndex] as unknown as { y?: number }).y ?? yVal
                      : yVal;
                    const invVal = Math.max(0, yVal - cashVal);
                    return `${item.dataset.label}: ${val} ${currencySymbol} (davon Anlagen: ${invVal.toFixed(2)} ${currencySymbol})`;
                  }
                  return `${item.dataset.label}: ${val} ${currencySymbol}`;
                }
              }
            }
          }
        }
      });
    };

    const animationFrameId = requestAnimationFrame(updateChart);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [pastPoints, futurePoints, minDate, maxDate, currencySymbol, now, child.balance, theme, investments, prices]);

  return (
    <div className="glass-panel p-2">
      {/* Header with Title and Timeframe Selector */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.75rem'
      }}>
        <h3 className="form-label" style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>
          Taschengeldentwicklung & Zukunftsprognose
        </h3>
        
        <div style={{
          display: 'flex',
          background: 'var(--border-color)',
          padding: '2px',
          borderRadius: '8px',
          gap: '2px'
        }}>
          {[30, 90, 180, 365].map(days => (
            <button
              key={days}
              type="button"
              style={{
                background: projectionDays === days ? 'var(--color-primary)' : 'transparent',
                color: projectionDays === days ? 'var(--color-primary-text)' : 'var(--text-secondary)',
                border: 'none',
                padding: '0.25rem 0.65rem',
                fontSize: '0.75rem',
                fontWeight: 600,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: projectionDays === days ? '0 2px 6px var(--color-primary-glow)' : 'none'
              }}
              onClick={() => setProjectionDays(days)}
            >
              {days === 365 ? '1 Jahr' : `${days} Tage`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', height: '240px' }}>
        <canvas ref={canvasRef} />
      </div>

      <div style={{ display: 'flex', gap: '1.25rem', justifyContent: 'center', marginTop: '1rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: '12px', height: '4px', background: 'var(--color-primary)', display: 'inline-block', borderRadius: '2px' }}></span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Historisches Guthaben</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: '12px', height: '4px', borderTop: '2px dashed var(--color-success)', display: 'inline-block' }}></span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Frei verfügbares Guthaben (Prognose)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ width: '12px', height: '4px', background: 'var(--color-primary)', display: 'inline-block', borderRadius: '2px' }}></span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Gesamtvermögen (Prognose, inkl. Anlagen)</span>
        </div>
      </div>
    </div>
  );
};
