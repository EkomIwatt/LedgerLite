/**
 * The three visualisations, driven by Contract 5 fixtures.
 *
 * The assertions deliberately target the TEXT each chart produces rather than
 * its SVG: jsdom gives ResponsiveContainer a zero-size box so the paths are not
 * meaningfully renderable, and more importantly the text is what a screen
 * reader gets. If the accessible content is right, the chart is answerable;
 * if it is only right in the SVG, it is not.
 *
 * Two behaviours here are contract requirements rather than polish:
 *   - every chart has a designed empty state, because a brand-new account gets
 *     zeroed totals and an empty `categories` array from all three endpoints
 *   - `remaining_minor` may be negative and `percent_used` may exceed 100, and
 *     neither may be clamped away
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { AnalyticsByCategory, AnalyticsMonthly, AnalyticsSummary } from '../api/types';
import { BudgetGauge } from '../charts/BudgetGauge';
import { CategoryPie } from '../charts/CategoryPie';
import { MonthlyBar } from '../charts/MonthlyBar';

const EMPTY_BREAKDOWN: AnalyticsByCategory = {
  month: '2026-09',
  currency: 'NGN',
  total_spent_minor: 0,
  categories: [],
};

const EMPTY_SUMMARY: AnalyticsSummary = {
  month: '2026-09',
  currency: 'NGN',
  total_spent_minor: 0,
  total_budget_minor: 0,
  remaining_minor: 0,
  percent_used: 0,
  expense_count: 0,
};

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('CategoryPie (Contract 5b)', () => {
  it('shows a designed empty state instead of crashing on []', () => {
    render(<CategoryPie data={EMPTY_BREAKDOWN} loading={false} error={null} />);

    expect(screen.getByText('Nothing logged this month')).toBeInTheDocument();
  });

  it('renders every slice as a legend row carrying its own figures', () => {
    const data: AnalyticsByCategory = {
      month: '2026-09',
      currency: 'NGN',
      total_spent_minor: 300000,
      categories: [
        {
          category: 'food',
          label: 'Food',
          color: '#E8734A',
          spent_minor: 200000,
          percent: 66.7,
          limit_minor: null,
          remaining_minor: null,
          percent_used: null,
          over_budget: false,
        },
        {
          category: 'transport',
          label: 'Transport',
          color: '#4A8FE8',
          spent_minor: 100000,
          percent: 33.3,
          limit_minor: null,
          remaining_minor: null,
          percent_used: null,
          over_budget: false,
        },
      ],
    };

    render(<CategoryPie data={data} loading={false} error={null} />);

    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.getByText('₦2,000.00')).toBeInTheDocument();
    expect(screen.getByText('66.7%')).toBeInTheDocument();
    expect(screen.getByText('Transport')).toBeInTheDocument();
    expect(screen.getByText('33.3%')).toBeInTheDocument();
  });

  it('uses the colour the server sent, not one of its own', () => {
    const data: AnalyticsByCategory = {
      ...EMPTY_BREAKDOWN,
      total_spent_minor: 1000,
      categories: [
        {
          category: 'food',
          label: 'Food',
          color: '#E8734A',
          spent_minor: 1000,
          percent: 100,
          limit_minor: null,
          remaining_minor: null,
          percent_used: null,
          over_budget: false,
        },
      ],
    };

    const { container } = render(<CategoryPie data={data} loading={false} error={null} />);
    const swatch = container.querySelector('.legend__swatch');

    expect(swatch).toHaveStyle({ background: '#E8734A' });
  });

  it('keeps a zero-spend budgeted category out of the pie but not out of the data', () => {
    // Contract 5b includes it so the gauge can show an untouched budget. A
    // zero-area slice would be invisible, so the pie omits it - and the budget
    // gauge is where that row is actually rendered.
    const data: AnalyticsByCategory = {
      month: '2026-09',
      currency: 'NGN',
      total_spent_minor: 1000,
      categories: [
        {
          category: 'food',
          label: 'Food',
          color: '#E8734A',
          spent_minor: 1000,
          percent: 100,
          limit_minor: null,
          remaining_minor: null,
          percent_used: null,
          over_budget: false,
        },
        {
          category: 'savings',
          label: 'Savings',
          color: '#5B7FA6',
          spent_minor: 0,
          percent: 0,
          limit_minor: 500000,
          remaining_minor: 500000,
          percent_used: 0,
          over_budget: false,
        },
      ],
    };

    render(<CategoryPie data={data} loading={false} error={null} />);

    expect(screen.getByText('Food')).toBeInTheDocument();
    expect(screen.queryByText('Savings')).not.toBeInTheDocument();
  });
});

describe('MonthlyBar (Contract 5c)', () => {
  it('shows an empty state when there is no spending history at all', () => {
    const data: AnalyticsMonthly = {
      currency: 'NGN',
      months: [
        { month: '2026-08', total_spent_minor: 0, total_budget_minor: 0 },
        { month: '2026-09', total_spent_minor: 0, total_budget_minor: 0 },
      ],
    };

    render(<MonthlyBar data={data} loading={false} error={null} />);

    expect(screen.getByText('No spending history yet')).toBeInTheDocument();
  });

  it('renders the zero-filled series exactly as received, gaps included', () => {
    const data: AnalyticsMonthly = {
      currency: 'NGN',
      months: [
        { month: '2026-07', total_spent_minor: 70000, total_budget_minor: 0 },
        { month: '2026-08', total_spent_minor: 0, total_budget_minor: 0 },
        { month: '2026-09', total_spent_minor: 30000, total_budget_minor: 0 },
      ],
    };

    render(<MonthlyBar data={data} loading={false} error={null} />);

    const table = screen.getByRole('table', {
      name: /Total spending for each of the last months/i,
    });
    // The August zero is present, not skipped. No client-side gap filling was
    // needed to make that true - it arrived that way.
    expect(within(table).getByText('Aug 2026')).toBeInTheDocument();
    expect(within(table).getByText('Jul 2026')).toBeInTheDocument();
    expect(within(table).getByText('Sep 2026')).toBeInTheDocument();
  });
});

describe('BudgetGauge (Contract 5a + 5b)', () => {
  it('invites the user to set budgets when none exist, rather than showing an empty dial', () => {
    renderWithRouter(
      <BudgetGauge
        summary={EMPTY_SUMMARY}
        breakdown={EMPTY_BREAKDOWN}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText('No budgets set for this month')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set budgets' })).toBeInTheDocument();
  });

  it('shows what is left when the month is inside its budget', () => {
    const summary: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      total_spent_minor: 734000,
      total_budget_minor: 1000000,
      remaining_minor: 266000,
      percent_used: 73.4,
      expense_count: 12,
    };

    renderWithRouter(
      <BudgetGauge summary={summary} breakdown={EMPTY_BREAKDOWN} loading={false} error={null} />,
    );

    expect(screen.getByText('73.4%')).toBeInTheDocument();
    expect(screen.getByText('₦2,660.00 left to spend')).toBeInTheDocument();
  });

  it('states the overspend as a figure instead of clamping the gauge at 100%', () => {
    const summary: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      total_spent_minor: 1450000,
      total_budget_minor: 1000000,
      remaining_minor: -450000,
      percent_used: 145,
      expense_count: 20,
    };

    renderWithRouter(
      <BudgetGauge summary={summary} breakdown={EMPTY_BREAKDOWN} loading={false} error={null} />,
    );

    // The true percentage survives, even though a circle cannot draw 145%.
    expect(screen.getByText('145%')).toBeInTheDocument();
    expect(screen.getByText('₦4,500.00 over budget')).toBeInTheDocument();
  });

  it('renders a per-category meter with an accessible description of its state', () => {
    const summary: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      total_spent_minor: 1250000,
      total_budget_minor: 1000000,
      remaining_minor: -250000,
      percent_used: 125,
      expense_count: 4,
    };
    const breakdown: AnalyticsByCategory = {
      month: '2026-09',
      currency: 'NGN',
      total_spent_minor: 1250000,
      categories: [
        {
          category: 'food',
          label: 'Food',
          color: '#E8734A',
          spent_minor: 1250000,
          percent: 100,
          limit_minor: 1000000,
          remaining_minor: -250000,
          percent_used: 125,
          over_budget: true,
        },
      ],
    };

    renderWithRouter(
      <BudgetGauge summary={summary} breakdown={breakdown} loading={false} error={null} />,
    );

    expect(screen.getByText('Over')).toBeInTheDocument();
    expect(screen.getByText('₦12,500.00 / ₦10,000.00')).toBeInTheDocument();
    // Colour is never the only signal: the meter says so in words too.
    expect(
      screen.getByRole('meter', { name: /Food: 125% of budget used, ₦2,500.00 over/i }),
    ).toBeInTheDocument();
  });

  it('names spending that has no budget behind it', () => {
    const summary: AnalyticsSummary = {
      ...EMPTY_SUMMARY,
      total_spent_minor: 500000,
      total_budget_minor: 1000000,
      remaining_minor: 500000,
      percent_used: 50,
      expense_count: 2,
    };
    const breakdown: AnalyticsByCategory = {
      month: '2026-09',
      currency: 'NGN',
      total_spent_minor: 500000,
      categories: [
        {
          category: 'shopping',
          label: 'Shopping',
          color: '#E8A93A',
          spent_minor: 500000,
          percent: 100,
          limit_minor: null,
          remaining_minor: null,
          percent_used: null,
          over_budget: false,
        },
      ],
    };

    renderWithRouter(
      <BudgetGauge summary={summary} breakdown={breakdown} loading={false} error={null} />,
    );

    expect(screen.getByText(/Not budgeted:\s*Shopping ₦5,000.00/)).toBeInTheDocument();
  });
});
