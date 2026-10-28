import { render, fireEvent, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Home, Setup, Game, Results } from './preview';
import { TypingComposer } from '../components/ui';
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
});
async function mount(component: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: Infinity } },
        })
      }
    >
      {component}
    </QueryClientProvider>,
  );
}
test('home labels mock data and navigates with the correct setup context', async () => {
  await mount(<Home />);
  expect(screen.getByText('Development preview · Mock data')).toBeTruthy();
  await fireEvent.press(screen.getByText('Quick Match'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/setup',
    params: { kind: 'quick' },
  });
  await fireEvent.press(screen.getByText('Play with Friend'));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/setup',
    params: { kind: 'friend' },
  });
  await fireEvent.press(screen.getByText('Preview empty stats'));
  expect(screen.getByText('—')).toBeTruthy();
});
test('Quick Match fixes General and Challenge hides Classic difficulty', async () => {
  await mount(<Setup />);
  expect(screen.getByText('General · All Words')).toBeTruthy();
  expect(screen.queryByText('Animals')).toBeNull();
  expect(screen.getByText('5 Expert')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Challenge'));
  expect(screen.queryByText('5 Expert')).toBeNull();
  await fireEvent.press(screen.getByText('Preview game'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/game',
    params: { mode: 'challenge', categorySlug: 'general' },
  });
});
test('friend setup preserves category and Classic difficulty', async () => {
  mockParams = { kind: 'friend' };
  await mount(<Setup />);
  await fireEvent.press(screen.getByText('Animals'));
  await fireEvent.press(screen.getByText('4 Hard'));
  await fireEvent.press(screen.getByText('Preview game'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/game',
    params: { mode: 'classic', categorySlug: 'animals', difficulty: 4 },
  });
});
test('game uses valid metadata and submissions never award points', async () => {
  await mount(<Game />);
  expect(screen.getByText('Round 2 of 5 · Level 2')).toBeTruthy();
  await fireEvent.changeText(
    screen.getByLabelText('Your spelling'),
    'arbitrary input',
  );
  await fireEvent.press(screen.getByText('Submit'));
  expect(
    screen.getByText(
      'Submission preview only. No answer was checked or scored.',
    ),
  ).toBeTruthy();
  expect(screen.getByText('3 attempts left')).toBeTruthy();
  await fireEvent.press(screen.getByText('Preview state: typing'));
  expect(screen.getByLabelText('Your spelling')).toHaveProp('editable', false);
});
test('return key shares the submit callback and pending input is locked', async () => {
  const submit = jest.fn();
  const view = await render(
    <TypingComposer
      value="input"
      onChange={jest.fn()}
      onSubmit={submit}
      enabled
      attempts={3}
    />,
  );
  await fireEvent(screen.getByLabelText('Your spelling'), 'submitEditing');
  expect(submit).toHaveBeenCalledTimes(1);
  await view.rerender(
    <TypingComposer
      value="input"
      onChange={jest.fn()}
      onSubmit={submit}
      enabled
      attempts={2}
      pending
    />,
  );
  await fireEvent(screen.getByLabelText('Your spelling'), 'submitEditing');
  expect(submit).toHaveBeenCalledTimes(1);
});
test('spelling input requests no keyboard assistance or autofill', async () => {
  await mount(<Game />);
  const input = screen.getByLabelText('Your spelling');
  expect(input).toHaveProp('autoCorrect', false);
  expect(input).toHaveProp('spellCheck', false);
  expect(input).toHaveProp('autoComplete', 'off');
  expect(input).toHaveProp('importantForAutofill', 'no');
  expect(input).toHaveProp('smartInsertDelete', false);
  expect(input).toHaveProp('autoCapitalize', 'none');
  expect(input).toHaveProp('contextMenuHidden', true);
});
test('interrupted result never presents a winner and home navigation works', async () => {
  await mount(<Results />);
  for (let i = 0; i < 3; i++)
    await fireEvent.press(screen.getByText('Preview next outcome'));
  expect(screen.getByText('Match interrupted')).toBeTruthy();
  expect(screen.queryByText('Rematch')).toBeNull();
  await fireEvent.press(screen.getByText('Back Home'));
  expect(mockReplace).toHaveBeenCalledWith('/');
});
