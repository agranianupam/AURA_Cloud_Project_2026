import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn, signUp, confirmSignUp, resendSignUpCode, resetPassword, confirmResetPassword } from 'aws-amplify/auth';

const MOCK = import.meta.env.VITE_USE_MOCK === "true";
const PASSWORD_RULE = 'At least 10 characters, with an uppercase letter, a lowercase letter and a number.';

const TITLES = {
  signin: 'AURA Login',
  signup: 'Create your AURA account',
  confirm: 'Verify your email',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
};

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      <input required {...props} className="mt-1 block w-full rounded-md border border-gray-300 p-2 text-gray-900" />
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function LinkButton({ onClick, children }) {
  return <button type="button" onClick={onClick} className="text-indigo-600 hover:text-indigo-800 font-medium">{children}</button>;
}

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const go = (next, message = null) => {
    setMode(next);
    setError(null);
    setNotice(message);
    setCode('');
    setPassword('');
    setConfirmPassword('');
  };

  const finishLogin = () => {
    onLogin(email);
    navigate('/overview');
  };

  const run = (action) => async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      if (err.name === 'UserAlreadyAuthenticatedException') return finishLogin();
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = run(async () => {
    if (MOCK) return finishLogin();
    const { nextStep } = await signIn({ username: email, password });
    if (nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
      await resendSignUpCode({ username: email });
      return go('confirm', `Your email isn't verified yet. We sent a new code to ${email}.`);
    }
    finishLogin();
  });

  const handleSignUp = run(async () => {
    if (password !== confirmPassword) throw new Error('The two passwords do not match.');
    await signUp({ username: email, password, options: { userAttributes: { email } } });
    go('confirm', `We sent a 6-digit code to ${email}. Enter it below to activate your account.`);
  });

  const handleConfirm = run(async () => {
    await confirmSignUp({ username: email, confirmationCode: code.trim() });
    go('signin', 'Email verified. You can sign in now.');
  });

  const handleResend = run(async () => {
    await resendSignUpCode({ username: email });
    setNotice(`A new code is on its way to ${email}.`);
  });

  const handleForgot = run(async () => {
    await resetPassword({ username: email });
    go('reset', `If an account exists for ${email}, we sent it a 6-digit reset code.`);
  });

  const handleReset = run(async () => {
    if (password !== confirmPassword) throw new Error('The two passwords do not match.');
    await confirmResetPassword({ username: email, confirmationCode: code.trim(), newPassword: password });
    go('signin', 'Password changed. Sign in with your new password.');
  });

  const submitLabel = {
    signin: ['Sign In', 'Signing in...'],
    signup: ['Create account', 'Creating account...'],
    confirm: ['Verify email', 'Verifying...'],
    forgot: ['Send reset code', 'Sending...'],
    reset: ['Change password', 'Saving...'],
  }[mode];
  const onSubmit = { signin: handleSignIn, signup: handleSignUp, confirm: handleConfirm, forgot: handleForgot, reset: handleReset }[mode];

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-xl shadow border border-gray-100 p-8">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">{TITLES[mode]}</h2>
        {notice && <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm">{notice}</div>}
        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
                 readOnly={mode === 'confirm' || mode === 'reset'} />
          {(mode === 'confirm' || mode === 'reset') && (
            <Field label="Verification code" inputMode="numeric" autoComplete="one-time-code" value={code}
                   onChange={e => setCode(e.target.value)} hint="Check your inbox (and spam folder) for the 6-digit code." />
          )}
          {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
            <Field label={mode === 'reset' ? 'New password' : 'Password'} type="password"
                   autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password}
                   onChange={e => setPassword(e.target.value)} hint={mode === 'signin' ? null : PASSWORD_RULE} />
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <Field label="Confirm password" type="password" autoComplete="new-password" value={confirmPassword}
                   onChange={e => setConfirmPassword(e.target.value)} />
          )}
          {mode === 'signin' && (
            <div className="text-right text-sm">
              <LinkButton onClick={() => go('forgot')}>Forgot password?</LinkButton>
            </div>
          )}
          <button type="submit" disabled={loading}
                  className="w-full py-2 px-4 shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none disabled:opacity-50">
            {loading ? submitLabel[1] : submitLabel[0]}
          </button>
        </form>
        <div className="mt-6 text-center text-sm text-gray-600 space-y-2">
          {mode === 'signin' && !MOCK && <p>New to AURA? <LinkButton onClick={() => go('signup')}>Create an account</LinkButton></p>}
          {mode === 'confirm' && <p>Didn't get a code? <LinkButton onClick={handleResend}>Resend code</LinkButton></p>}
          {mode !== 'signin' && <p><LinkButton onClick={() => go('signin')}>Back to sign in</LinkButton></p>}
        </div>
      </div>
    </div>
  );
}
