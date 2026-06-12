import React, { useMemo, useEffect, useRef, useState } from 'react';
import type { Transaction, UserProfile } from '../types';
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

// Register Chart.js components if they haven't been already
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

interface GirokontoChartProps {
  child: UserProfile;
  transactions: Transaction[];
  currencySymbol: string;
}

export const GirokontoChart: React.FC<GirokontoChartProps> = ({
  child,
  transactions,
  currencySymbol
}) => {
  const { theme } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);

  // Timeframe selector (in days of history to show)
  const [historyDays, setHistoryDays] = useState<number>(90);
  const [now] = useState(() => Date.now());

  // Data signatures to prevent unnecessary redraws
  const txsSignature = useMemo(() => {
    return transactions
      .filter(t => t.category === 'Girokonto Einzahlung' || t.category === 'Girokonto Anpassung')
      .map(t => `${t.id}-${t.amount}-${t.giroDelta || 0}-${t.date}`)
      .join(',');
  }, [transactions]);

  // Memoized chart data
  const chartData = useMemo(() => {
    const startDateLimit = now - historyDays * 24 * 60 * 60 * 1000;
    
    // Sort transactions chronologically
    const giroTxs = transactions
      .filter(tx => tx.category === 'Girokonto Einzahlung' || tx.category === 'Girokonto Anpassung')
      .sort((a, b) => b.date - a.date); // newest first

    let tempGiro = child.giroBalance || 0;
    const points: { date: number; balance: number }[] = [
      { date: now, balance: tempGiro }
    ];

    for (let i = 0; i < giroTxs.length; i++) {
      const tx = giroTxs[i];
      if (tx.date < startDateLimit) break;
      
      const delta = tx.giroDelta ?? (tx.category === 'Girokonto Einzahlung' ? Math.abs(tx.amount) : 0);
      tempGiro = Number((tempGiro - delta).toFixed(2));
      points.unshift({ date: tx.date, balance: tempGiro });
    }

    // Ensure we have a starting point at the beginning of the selected timeframe
    if (points.length > 0 && points[0].date > startDateLimit) {
      points.unshift({ date: startDateLimit, balance: points[0].balance });
    }

    return {
      points,
      minDate: startDateLimit,
      maxDate: now
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [child.giroBalance, txsSignature, now, historyDays]);

  const { points, minDate, maxDate } = chartData;

  const formatDateLabel = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  };

  useEffect(() => {
    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const updateChart = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const style = getComputedStyle(document.documentElement);
      const warningColor = style.getPropertyValue('--color-warning').trim() || '#ff9f1c';
      const textColor = style.getPropertyValue('--text-secondary').trim() || '#94a3b8';
      const gridColor = style.getPropertyValue('--border-color').trim() || 'rgba(255, 255, 255, 0.08)';
      const fontPrimary = style.getPropertyValue('--font-primary').trim() || 'Outfit';

      // Gradient under the Giro line
      const lineGradient = ctx.createLinearGradient(0, 0, 0, 220);
      lineGradient.addColorStop(0, warningColor + '30'); // ~18% opacity
      lineGradient.addColorStop(1, warningColor + '00'); // 0% opacity

      if (chartInstanceRef.current) {
        const chart = chartInstanceRef.current;
        chart.data.datasets[0].data = points.map(p => ({ x: p.date, y: p.balance }));
        chart.data.datasets[0].backgroundColor = lineGradient;
        chart.data.datasets[0].borderColor = warningColor;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (chart.data.datasets[0] as any).pointBackgroundColor = warningColor;

        chart.options.scales!.x!.min = minDate;
        chart.options.scales!.x!.max = maxDate;
        
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

      chartInstanceRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Girokonto-Stand',
              data: points.map(p => ({ x: p.date, y: p.balance })),
              borderColor: warningColor,
              backgroundColor: lineGradient,
              borderWidth: 3.5,
              tension: 0,
              fill: true,
              pointRadius: points.length > 50 ? 0 : 2,
              pointHoverRadius: 5,
              pointHitRadius: 10,
              pointBackgroundColor: warningColor,
              pointBorderColor: '#fff',
              pointBorderWidth: 1.5,
              stepped: 'before'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              top: 10
            }
          },
          scales: {
            x: {
              type: 'linear',
              min: minDate,
              max: maxDate,
              ticks: {
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
                callback: (value: number | string) => `${Number(value).toFixed(2)} ${currencySymbol}`
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
                  return `${item.dataset.label}: ${yVal.toFixed(2)} ${currencySymbol}`;
                }
              }
            }
          }
        }
      });
    };

    const animationFrameId = requestAnimationFrame(updateChart);
    return () => cancelAnimationFrame(animationFrameId);
  }, [points, minDate, maxDate, currencySymbol, theme]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
          Guthaben-Entwicklung (Historisch)
        </h4>
        <div style={{ display: 'flex', background: 'var(--border-color)', padding: '2px', borderRadius: '6px', gap: '2px' }}>
          {[30, 90, 180].map(days => (
            <button
              key={days}
              type="button"
              style={{
                background: historyDays === days ? 'var(--color-warning)' : 'transparent',
                color: historyDays === days ? 'var(--bg-app)' : 'var(--text-secondary)',
                border: 'none',
                padding: '0.2rem 0.5rem',
                fontSize: '0.7rem',
                fontWeight: 700,
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={() => setHistoryDays(days)}
            >
              {days} Tage
            </button>
          ))}
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', height: '200px' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};
