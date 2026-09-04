/**
 * The whole app, driven through the UI against the mock backend.
 *
 * Everything below the render is real: the router, the auth context, the API
 * client with its refresh logic, and the mock standing in for Instance 1. Only
 * the transport is swapped, which is the same swap `VITE_USE_MOCKS` performs.
 *
 * The boot-sequence tests are the important ones. Contract 1 requires exactly
 * one POST /api/auth/refresh on boot, a loading state while it is in flight,
 * and no flash of the sign-in screen at a user who is already signed in - and
 * that last one is a bug you cannot see in a screenshot.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { resetRefreshState, setTransport } from '../api/client';
import { DEMO_EMAIL, DEMO_PASSWORD, mockFetch, resetMockBackend } from '../api/mocks';
import { clearAccessToken } from '../api/tokenStore';

/**
 * The mock, slowed down.
 *
 * Two tests below assert a TRANSIENT state - the boot screen, which exists only
 * while POST /api/auth/refresh is in flight. Against the bare mock that window
 * is a few microtasks wide, so the assertion is racing the very thing it is
 * checking. Holding each response for a tick makes the window real and the test
 * deterministic, without changing any behaviour under test.
 */
function useSlowTransport(delayMs = 25) {
  setTransport(async (input, init) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return mockFetch(input, init);
  });
}

function seedLiveSession(email = 'live@example.com', password = 'correct horse') {
  // Signing up through the mock leaves its simulated refresh cookie in place,
  // which is what a real browser would still be holding after a page reload.
  return mockFetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

beforeEach(() => {
  resetMockBackend({ seed: true });
  setTransport(mockFetch);
  clearAccessToken();
  resetRefreshState();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  setTransport(null);
  clearAccessToken();
  resetRefreshState();
});

describe('boot sequence', () => {
  it('shows a loading state, then the sign-in screen, when there is no session', async () => {
    useSlowTransport();
    render(<App />);

    expect(screen.getByText('Restoring session')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('does not show a session-expired notice to a first-time visitor', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByText(/Session expired/i)).not.toBeInTheDocument();
  });

  it('restores a live session without flashing the sign-in screen', async () => {
    await seedLiveSession();
    clearAccessToken(); // as after a reload: the cookie survives, the token does not
    useSlowTransport();

    render(<App />);

    // While the boot refresh is in flight the answer is "not yet", not "no".
    expect(screen.getByText('Restoring session')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });
});

describe('signing in and out', () => {
  it('signs in and lands on the dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.type(screen.getByLabelText('Email'), DEMO_EMAIL);
    await user.type(screen.getByLabelText('Password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByText(DEMO_EMAIL)).toBeInTheDocument();
  });

  it('shows the server sentence - and no more - for bad credentials', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.type(screen.getByLabelText('Email'), DEMO_EMAIL);
    await user.type(screen.getByLabelText('Password'), 'not the password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Contract 1 returns this same sentence for an unknown email, so the UI
    // leaks nothing the API was careful not to.
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  });

  it('signs out back to the sign-in screen', async () => {
    const user = userEvent.setup();
    await seedLiveSession();
    clearAccessToken();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('carries a deep link through the sign-in round trip', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/budgets');

    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.type(screen.getByLabelText('Email'), DEMO_EMAIL);
    await user.type(screen.getByLabelText('Password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // Back to where they were originally heading, not to the dashboard.
    expect(await screen.findByRole('heading', { name: 'Budgets' })).toBeInTheDocument();
  });
});

describe('signing up', () => {
  it('creates an account and drops straight into the app', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Sign in' });

    await user.click(screen.getByRole('link', { name: 'Create one' }));
    await screen.findByRole('heading', { name: 'Create an account' });

    await user.type(screen.getByLabelText('Email'), 'brand.new@example.com');
    await user.type(screen.getByLabelText('Password'), 'a good password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('refuses a short password before spending a round trip on it', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/signup');
    render(<App />);
    await screen.findByRole('heading', { name: 'Create an account' });

    await user.type(screen.getByLabelText('Email'), 'short@example.com');
    await user.type(screen.getByLabelText('Password'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('Password must be at least 8 characters.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument();
  });

  it('reports a taken email with the server sentence', async () => {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/signup');
    render(<App />);
    await screen.findByRole('heading', { name: 'Create an account' });

    await user.type(screen.getByLabelText('Email'), DEMO_EMAIL);
    await user.type(screen.getByLabelText('Password'), 'a good password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      await screen.findByText('An account with that email already exists.'),
    ).toBeInTheDocument();
  });
});

describe('expenses', () => {
  async function signInAsNewUser() {
    const user = userEvent.setup();
    window.history.pushState({}, '', '/signup');
    render(<App />);
    await screen.findByRole('heading', { name: 'Create an account' });

    await user.type(screen.getByLabelText('Email'), 'ledger@example.com');
    await user.type(screen.getByLabelText('Password'), 'a good password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('navigation', { name: 'Main' });

    await user.click(screen.getByRole('link', { name: 'Expenses' }));
    await screen.findByRole('heading', { name: 'Expenses' });
    return user;
  }

  it('adds, edits and deletes an expense end to end', async () => {
    const user = await signInAsNewUser();

    // --- The empty ledger states its own case ---
    expect(await screen.findByText('No expenses here')).toBeInTheDocument();

    // --- Add ---
    await user.click(screen.getByRole('button', { name: /Add expense/ }));
    const addDialog = await screen.findByRole('dialog', { name: 'Add an expense' });

    await user.type(within(addDialog).getByLabelText('Amount'), '2499.00');
    await user.selectOptions(within(addDialog).getByLabelText('Category'), 'transport');
    await user.type(within(addDialog).getByLabelText('Note'), 'Fuel');
    await user.click(within(addDialog).getByRole('button', { name: 'Add expense' }));

    // Scoped to the ledger: "Transport" is also an <option> in the filter.
    const ledger = await screen.findByRole('table', { name: /Expenses for/ });
    expect(await within(ledger).findByText('₦2,499.00')).toBeInTheDocument();
    expect(within(ledger).getByText('Fuel')).toBeInTheDocument();
    expect(within(ledger).getByText('Transport')).toBeInTheDocument();

    // --- Edit ---
    await user.click(screen.getByRole('button', { name: /^Edit expense of ₦2,499\.00/ }));
    const editDialog = await screen.findByRole('dialog', { name: 'Edit expense' });

    const amountField = within(editDialog).getByLabelText('Amount');
    await user.clear(amountField);
    await user.type(amountField, '3100.50');
    await user.click(within(editDialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('₦3,100.50')).toBeInTheDocument();
    expect(screen.queryByText('₦2,499.00')).not.toBeInTheDocument();

    // --- Delete, with a confirmation step ---
    await user.click(screen.getByRole('button', { name: /^Delete expense of ₦3,100\.50/ }));
    const deleteDialog = await screen.findByRole('dialog', { name: 'Delete this expense?' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete expense' }));

    expect(await screen.findByText('No expenses here')).toBeInTheDocument();
  });

  it('rejects a zero amount without sending it', async () => {
    const user = await signInAsNewUser();

    await user.click(screen.getByRole('button', { name: /Add expense/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Add an expense' });

    await user.type(within(dialog).getByLabelText('Amount'), '0');
    await user.click(within(dialog).getByRole('button', { name: 'Add expense' }));

    expect(within(dialog).getByText('Enter an amount greater than zero.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add an expense' })).toBeInTheDocument();
  });

  it('closes the add dialog on Escape', async () => {
    const user = await signInAsNewUser();

    await user.click(screen.getByRole('button', { name: /Add expense/ }));
    await screen.findByRole('dialog', { name: 'Add an expense' });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add an expense' })).not.toBeInTheDocument();
    });
  });
});

describe('budgets', () => {
  it('sets, updates and removes a monthly limit', async () => {
    const user = userEvent.setup();
    await seedLiveSession('budgeter@example.com');
    clearAccessToken();
    window.history.pushState({}, '', '/budgets');

    render(<App />);
    await screen.findByRole('heading', { name: 'Budgets' });

    const foodLimit = await screen.findByLabelText('Food');
    await user.type(foodLimit, '35000');
    await user.click(screen.getByRole('button', { name: 'Set the Food budget' }));

    // Once saved, the row's action becomes "Update" and removal is enabled.
    const removeFood = await screen.findByRole('button', { name: /Remove the Food budget/ });
    await waitFor(() => expect(removeFood).toBeEnabled());

    await user.click(removeFood);

    await waitFor(() => expect(screen.getByLabelText('Food')).toHaveValue(''));
  });
});
