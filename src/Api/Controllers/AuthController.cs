using System.ComponentModel.DataAnnotations;
using Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

// The validation attributes target the constructor *parameters*, not the generated properties.
// MVC throws rather than silently ignoring `[property: Required]` on a record, which surfaces
// as a 500 on every request to the endpoint.
/// <param name="Email">The staff member's sign-in address.</param>
/// <param name="Password">Their password.</param>
public sealed record LoginRequest(
    [Required, EmailAddress] string Email,
    [Required] string Password);

/// <param name="RefreshToken">The refresh token returned by a previous sign-in or refresh.</param>
public sealed record RefreshRequest([Required] string RefreshToken);

/// <summary>What the client stores after a successful sign-in.</summary>
public sealed record AuthResponse(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt,
    Guid TenantId,
    string DisplayName,
    IReadOnlyList<string> Roles);

/// <summary>
/// Sign-in for restaurant staff.
///
/// Anonymous by necessity — this is where a session begins. It is also the only unauthenticated
/// write path into the admin side, so it is the one that has to be careful: failures are
/// deliberately indistinguishable, and Identity's lockout does the rate limiting until the
/// dedicated limiter lands.
/// </summary>
[ApiController]
[Route("api/v1/auth")]
[AllowAnonymous]
public sealed class AuthController : ControllerBase
{
    private readonly UserManager<AppUser> _users;
    private readonly SignInManager<AppUser> _signIn;
    private readonly ITokenService _tokens;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        UserManager<AppUser> users,
        SignInManager<AppUser> signIn,
        ITokenService tokens,
        ILogger<AuthController> logger)
    {
        _users = users;
        _signIn = signIn;
        _tokens = tokens;
        _logger = logger;
    }

    /// <summary>Exchanges an email and password for an access token and a refresh token.</summary>
    /// <response code="200">Signed in.</response>
    /// <response code="401">Wrong credentials, or the account is disabled or locked out.</response>
    [HttpPost("login")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Login(LoginRequest request, CancellationToken ct)
    {
        var user = await _users.FindByEmailAsync(request.Email);

        // One response for every failure. Distinguishing "no such user" from "wrong password"
        // turns this endpoint into a way to enumerate who works here.
        if (user is null || !user.IsActive)
        {
            _logger.LogInformation("Rejected sign-in for an unknown or disabled account.");
            return Unauthorized(Problem401());
        }

        var result = await _signIn.CheckPasswordSignInAsync(user, request.Password, lockoutOnFailure: true);

        if (!result.Succeeded)
        {
            _logger.LogInformation(
                "Failed sign-in for user {UserId} (lockedOut: {LockedOut}).", user.Id, result.IsLockedOut);

            return Unauthorized(Problem401());
        }

        var issue = await _tokens.IssueAsync(user, ct);

        _logger.LogInformation("User {UserId} signed in for tenant {TenantId}.", user.Id, user.TenantId);

        return Ok(ToResponse(issue));
    }

    /// <summary>Exchanges a refresh token for a new pair, revoking the one presented.</summary>
    /// <response code="200">Rotated.</response>
    /// <response code="401">Unknown, expired, or already-used token.</response>
    [HttpPost("refresh")]
    [ProducesResponseType(typeof(AuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Refresh(RefreshRequest request, CancellationToken ct)
    {
        var issue = await _tokens.RefreshAsync(request.RefreshToken, ct);

        return issue is null ? Unauthorized(Problem401()) : Ok(ToResponse(issue));
    }

    /// <summary>Revokes one refresh token. Other sessions for the same user are untouched.</summary>
    /// <response code="204">Revoked, or it was already invalid — the client cannot tell.</response>
    [HttpPost("logout")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Logout(RefreshRequest request, CancellationToken ct)
    {
        await _tokens.RevokeAsync(request.RefreshToken, ct);

        return NoContent();
    }

    private static AuthResponse ToResponse(TokenIssue issue) => new(
        issue.Tokens.AccessToken,
        issue.Tokens.AccessTokenExpiresAt,
        issue.Tokens.RefreshToken,
        issue.Tokens.RefreshTokenExpiresAt,
        issue.TenantId,
        issue.DisplayName,
        issue.Roles);

    private static ProblemDetails Problem401() => new()
    {
        Title = "Sign-in failed",
        Status = StatusCodes.Status401Unauthorized,
        Detail = "Those credentials did not match an active account."
    };
}
