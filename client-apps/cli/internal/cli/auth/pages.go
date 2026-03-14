package auth

// successPage is rendered in the user's browser after a successful OAuth callback.
const successPage = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Login Successful - Stigmer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #1a1a2e 0%%, #16213e 50%%, #0f3460 100%%);
            padding: 20px;
        }
        .container {
            background: white; padding: 50px 40px; border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center; max-width: 480px; width: 100%%;
            position: relative; overflow: hidden;
        }
        .container::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
            background: linear-gradient(90deg, #667eea 0%%, #764ba2 100%%);
        }
        .success-icon { width: 64px; height: 64px; margin: 0 auto 20px; }
        .checkmark {
            width: 64px; height: 64px; border-radius: 50%%; display: inline-block;
            stroke-width: 3; stroke: #4CAF50; stroke-miterlimit: 10;
            box-shadow: inset 0px 0px 0px #4CAF50;
            animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both;
        }
        .checkmark__circle {
            stroke-dasharray: 166; stroke-dashoffset: 166;
            stroke-width: 3; stroke-miterlimit: 10; stroke: #4CAF50; fill: none;
            animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
        }
        .checkmark__check {
            transform-origin: 50%% 50%%;
            stroke-dasharray: 48; stroke-dashoffset: 48;
            animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
        }
        h1 { color: #1a1a2e; font-size: 28px; font-weight: 600; margin-bottom: 12px;
             animation: fadeInUp 0.6s ease-out 0.2s both; }
        .subtitle { color: #4CAF50; font-size: 16px; font-weight: 500; margin-bottom: 24px;
                    animation: fadeInUp 0.6s ease-out 0.3s both; }
        .message { color: #666; font-size: 15px; line-height: 1.6; margin-bottom: 28px;
                   animation: fadeInUp 0.6s ease-out 0.4s both; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, #e0e0e0, transparent);
                   margin: 28px 0; animation: fadeIn 0.6s ease-out 0.5s both; }
        .close-instruction {
            font-size: 14px; color: #999;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            animation: fadeInUp 0.6s ease-out 0.6s both;
        }
        .close-instruction::before { content: '\2192'; font-size: 16px; }
        @keyframes stroke { 100%% { stroke-dashoffset: 0; } }
        @keyframes scale { 0%%, 100%% { transform: none; } 50%% { transform: scale3d(1.1, 1.1, 1); } }
        @keyframes fill { 100%% { box-shadow: inset 0px 0px 0px 30px #4CAF50; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">
            <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                <circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
            </svg>
        </div>
        <h1>Login Successful!</h1>
        <p class="subtitle">Authentication Complete</p>
        <p class="message">You have successfully authenticated with Stigmer.<br>Your credentials are now securely stored.</p>
        <div class="divider"></div>
        <p class="close-instruction">You can close this window and return to your terminal</p>
    </div>
</body>
</html>`

// errorPage is rendered in the user's browser when the OAuth callback fails.
// It accepts three format arguments: user-friendly message, error code, error description.
const errorPage = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Login Failed - Stigmer</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #1a1a2e 0%%, #16213e 50%%, #0f3460 100%%);
            padding: 20px;
        }
        .container {
            background: white; padding: 50px 40px; border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            text-align: center; max-width: 480px; width: 100%%;
            position: relative; overflow: hidden;
        }
        .container::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px;
            background: linear-gradient(90deg, #f44336 0%%, #e91e63 100%%);
        }
        .error-icon { width: 64px; height: 64px; margin: 0 auto 20px; }
        .error-circle {
            width: 64px; height: 64px; border-radius: 50%%; display: inline-block;
            stroke-width: 3; stroke: #f44336; stroke-miterlimit: 10;
            box-shadow: inset 0px 0px 0px #f44336;
            animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both;
        }
        .error-circle__shape {
            stroke-dasharray: 166; stroke-dashoffset: 166;
            stroke-width: 3; stroke-miterlimit: 10; stroke: #f44336; fill: none;
            animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards;
        }
        .error-x {
            transform-origin: 50%% 50%%;
            stroke-dasharray: 48; stroke-dashoffset: 48;
            animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards;
        }
        h1 { color: #1a1a2e; font-size: 28px; font-weight: 600; margin-bottom: 12px;
             animation: fadeInUp 0.6s ease-out 0.2s both; }
        .subtitle { color: #f44336; font-size: 16px; font-weight: 500; margin-bottom: 24px;
                    animation: fadeInUp 0.6s ease-out 0.3s both; }
        .message { color: #666; font-size: 15px; line-height: 1.6; margin-bottom: 20px;
                   animation: fadeInUp 0.6s ease-out 0.4s both; }
        .error-details {
            background: #fff3f3; border-left: 3px solid #f44336;
            padding: 12px 16px; margin: 20px 0; text-align: left; border-radius: 4px;
            animation: fadeInUp 0.6s ease-out 0.5s both;
        }
        .error-details-title { font-size: 12px; font-weight: 600; color: #d32f2f;
                               text-transform: uppercase; margin-bottom: 6px; }
        .error-details-text { font-size: 13px; color: #666; font-family: monospace; }
        .divider { height: 1px; background: linear-gradient(90deg, transparent, #e0e0e0, transparent);
                   margin: 28px 0; animation: fadeIn 0.6s ease-out 0.6s both; }
        .action-instruction {
            font-size: 14px; color: #999;
            display: flex; align-items: center; justify-content: center; gap: 8px;
            animation: fadeInUp 0.6s ease-out 0.7s both;
        }
        .action-instruction::before { content: '\2192'; font-size: 16px; }
        .retry-note {
            margin-top: 16px; padding: 12px; background: #f5f5f5; border-radius: 8px;
            font-size: 13px; color: #666;
            animation: fadeInUp 0.6s ease-out 0.8s both;
        }
        @keyframes stroke { 100%% { stroke-dashoffset: 0; } }
        @keyframes scale { 0%%, 100%% { transform: none; } 50%% { transform: scale3d(1.1, 1.1, 1); } }
        @keyframes fill { 100%% { box-shadow: inset 0px 0px 0px 30px #f44336; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">
            <svg class="error-circle" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                <circle class="error-circle__shape" cx="26" cy="26" r="25" fill="none"/>
                <line class="error-x" x1="18" y1="18" x2="34" y2="34" stroke="#f44336" stroke-width="3"/>
                <line class="error-x" x1="34" y1="18" x2="18" y2="34" stroke="#f44336" stroke-width="3"/>
            </svg>
        </div>
        <h1>Login Failed</h1>
        <p class="subtitle">Authentication Unsuccessful</p>
        <p class="message">%s</p>
        <div class="error-details">
            <div class="error-details-title">Error Details</div>
            <div class="error-details-text">%s: %s</div>
        </div>
        <div class="divider"></div>
        <p class="action-instruction">Close this window and return to your terminal</p>
        <div class="retry-note">
            To try again, run: <strong>stigmer auth login</strong>
        </div>
    </div>
</body>
</html>`
