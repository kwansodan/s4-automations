/**
 * Modern Passwordless Email OTP Login Component.
 */

import { state } from '../state.js';
import { requestOtp, verifyOtp } from '../api.js';

let currentStep = 'request'; // 'request' | 'verify'
let userEmail = 's4bookkeeping@service4gh.com';
let enteredOtp = '';
let isLoading = false;
let errorMessage = '';
let successMessage = '';
let countdownSeconds = 600;
let countdownTimer = null;
let devOtpHint = '';

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownSeconds = 600;
  countdownTimer = setInterval(() => {
    countdownSeconds -= 1;
    if (countdownSeconds <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    const timerEl = document.getElementById('otpCountdownText');
    if (timerEl) {
      const mins = Math.floor(countdownSeconds / 60);
      const secs = countdownSeconds % 60;
      timerEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
  }, 1000);
}

export function renderLoginView(container) {
  const isRequestStep = currentStep === 'request';
  const mins = Math.floor(countdownSeconds / 60);
  const secs = countdownSeconds % 60;
  const timerDisplay = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  container.innerHTML = `
    <div class="login-page-wrapper">
      <div class="login-glass-card">
        <!-- Logo & Branding -->
        <div class="login-brand-header">
          <div class="login-brand-icon">⚡</div>
          <h1 class="login-brand-title">S4 Automations</h1>
          <p class="login-brand-subtitle">Multi-Client Accounting & Financial Suite</p>
        </div>

        <div class="login-auth-badge">
          <span>🔒</span> Passwordless Email OTP Verification
        </div>

        <!-- Feedback Alert Messages -->
        ${
          errorMessage
            ? `<div class="login-alert login-alert-error">
                <span>⚠️</span> ${errorMessage}
              </div>`
            : ''
        }

        ${
          successMessage
            ? `<div class="login-alert login-alert-success">
                <span>✅</span> ${successMessage}
              </div>`
            : ''
        }

        ${
          isRequestStep
            ? `
          <!-- Step 1: Email Request Form -->
          <form id="formRequestOtp" class="login-form">
            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-size: 0.85rem; font-weight: 600; color: var(--text-color);">
                Authorized Administrator Email
              </label>
              <div style="position: relative;">
                <input 
                  type="email" 
                  id="inputAuthEmail" 
                  class="form-control" 
                  value="${userEmail}" 
                  placeholder="s4bookkeeping@service4gh.com"
                  required 
                  style="font-size: 0.95rem; padding-left: 2.5rem;"
                  ${isLoading ? 'disabled' : ''}
                />
                <span style="position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); font-size: 1rem;">✉️</span>
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.4rem;">
                A 6-digit single-use login code will be sent to this email address.
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 0.75rem; font-size: 0.95rem; justify-content: center;" ${isLoading ? 'disabled' : ''}>
              ${isLoading ? `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span> Sending Code...` : `<span>🚀</span> Send Verification Code`}
            </button>
          </form>
        `
            : `
          <!-- Step 2: 6-Digit OTP Verification Form -->
          <form id="formVerifyOtp" class="login-form">
            <div style="text-align: center; margin-bottom: 1.25rem;">
              <div style="font-size: 0.9rem; color: var(--text-color);">
                Enter the 6-digit code sent to:
              </div>
              <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem; margin-top: 0.15rem;">
                ${userEmail}
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 1.25rem;">
              <label class="form-label" style="font-size: 0.85rem; font-weight: 600; text-align: center; display: block;">
                6-Digit Verification Code
              </label>
              
              <div style="display: flex; justify-content: center; margin-top: 0.5rem;">
                <input 
                  type="text" 
                  id="inputOtpCode" 
                  class="form-control font-mono" 
                  placeholder="000000" 
                  maxlength="6" 
                  value="${enteredOtp}" 
                  autofocus
                  required
                  style="text-align: center; font-size: 1.8rem; letter-spacing: 0.5rem; font-weight: 700; max-width: 260px; padding: 0.6rem 0.5rem;"
                  ${isLoading ? 'disabled' : ''}
                />
              </div>

              ${
                devOtpHint
                  ? `
                <div style="margin-top: 0.75rem; text-align: center;">
                  <button type="button" class="btn btn-outline btn-sm" id="btnAutoFillDevOtp" style="font-size: 0.75rem; padding: 0.2rem 0.6rem;">
                    <span>⚡</span> Auto-fill: <strong>${devOtpHint}</strong>
                  </button>
                </div>
              `
                  : ''
              }

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.85rem; font-size: 0.8rem; color: var(--text-muted);">
                <span>Expires in: <strong id="otpCountdownText" style="color: var(--warning);">${timerDisplay}</strong></span>
                <button type="button" id="btnResendOtp" style="background: none; border: none; color: var(--primary); cursor: pointer; text-decoration: underline; font-size: 0.8rem;">
                  Resend Code
                </button>
              </div>
            </div>

            <button type="submit" class="btn btn-success" style="width: 100%; padding: 0.75rem; font-size: 0.95rem; justify-content: center;" ${isLoading ? 'disabled' : ''}>
              ${isLoading ? `<span class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span> Verifying...` : `<span>🔓</span> Verify & Access Hub`}
            </button>

            <div style="margin-top: 1rem; text-align: center;">
              <button type="button" id="btnChangeEmail" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem;">
                ← Use a different email
              </button>
            </div>
          </form>
        `
        }

        <div class="login-footer-info">
          <span>🛡️</span> Protected by S4 Multi-Client Accounting Security
        </div>
      </div>
    </div>
  `;

  // Attach Step 1 listeners
  const formRequest = container.querySelector('#formRequestOtp');
  if (formRequest) {
    formRequest.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = container.querySelector('#inputAuthEmail');
      userEmail = emailInput?.value.trim() || 's4bookkeeping@service4gh.com';

      isLoading = true;
      errorMessage = '';
      successMessage = '';
      renderLoginView(container);

      try {
        const res = await requestOtp(userEmail);
        isLoading = false;
        currentStep = 'verify';
        successMessage = res.message || `Verification code sent to ${userEmail}`;
        if (res.dev_hint) {
          const match = res.dev_hint.match(/\d{6}/);
          devOtpHint = match ? match[0] : '';
        } else {
          devOtpHint = '';
        }
        startCountdown();
        renderLoginView(container);
      } catch (err) {
        isLoading = false;
        errorMessage = err.message || 'Failed to send OTP code. Please verify email address.';
        renderLoginView(container);
      }
    });
  }

  // Attach Step 2 listeners
  const formVerify = container.querySelector('#formVerifyOtp');
  if (formVerify) {
    // Auto-focus and auto-submit on 6 digits
    const otpInput = container.querySelector('#inputOtpCode');
    if (otpInput) {
      otpInput.focus();
      otpInput.addEventListener('input', (e) => {
        enteredOtp = e.target.value.replace(/[^0-9]/g, '');
        e.target.value = enteredOtp;
        if (enteredOtp.length === 6) {
          formVerify.dispatchEvent(new Event('submit'));
        }
      });
    }

    // Auto-fill dev hint button
    const btnAutoFill = container.querySelector('#btnAutoFillDevOtp');
    if (btnAutoFill && devOtpHint) {
      btnAutoFill.addEventListener('click', () => {
        enteredOtp = devOtpHint;
        const inp = container.querySelector('#inputOtpCode');
        if (inp) {
          inp.value = devOtpHint;
          formVerify.dispatchEvent(new Event('submit'));
        }
      });
    }

    // Resend OTP
    const btnResend = container.querySelector('#btnResendOtp');
    if (btnResend) {
      btnResend.addEventListener('click', async () => {
        isLoading = true;
        errorMessage = '';
        renderLoginView(container);
        try {
          const res = await requestOtp(userEmail);
          isLoading = false;
          successMessage = 'A fresh 6-digit code has been sent.';
          if (res.dev_hint) {
            const match = res.dev_hint.match(/\d{6}/);
            devOtpHint = match ? match[0] : '';
          }
          startCountdown();
          renderLoginView(container);
        } catch (err) {
          isLoading = false;
          errorMessage = err.message || 'Failed to resend code.';
          renderLoginView(container);
        }
      });
    }

    // Change Email
    const btnChangeEmail = container.querySelector('#btnChangeEmail');
    if (btnChangeEmail) {
      btnChangeEmail.addEventListener('click', () => {
        currentStep = 'request';
        errorMessage = '';
        successMessage = '';
        enteredOtp = '';
        if (countdownTimer) clearInterval(countdownTimer);
        renderLoginView(container);
      });
    }

    formVerify.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = enteredOtp || container.querySelector('#inputOtpCode')?.value.trim();
      if (!code || code.length !== 6) {
        errorMessage = 'Please enter the complete 6-digit verification code.';
        renderLoginView(container);
        return;
      }

      isLoading = true;
      errorMessage = '';
      renderLoginView(container);

      try {
        const res = await verifyOtp(userEmail, code);
        isLoading = false;
        if (countdownTimer) clearInterval(countdownTimer);
        currentStep = 'request';
        enteredOtp = '';
        errorMessage = '';
        successMessage = '';
        // Successful login
        state.login(res.access_token, res.user);
        if (typeof window.loadBackendData === 'function') {
          window.loadBackendData();
        }
      } catch (err) {
        isLoading = false;
        errorMessage = err.message || 'Invalid or expired verification code.';
        renderLoginView(container);
      }
    });
  }
}
