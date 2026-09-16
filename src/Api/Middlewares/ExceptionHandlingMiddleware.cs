using Application.Common.Exceptions;
using Application.Features.Inventory;
using Domain.Exceptions;
using Microsoft.AspNetCore.Mvc;

namespace Api.Middlewares;

/// <summary>Turns domain/application exceptions into RFC 7807 problem responses.</summary>
public sealed class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            if (context.Response.HasStarted)
            {
                _logger.LogError(ex, "Unhandled exception after the response had started.");
                throw;
            }

            var (status, title) = Classify(ex);

            if (status >= StatusCodes.Status500InternalServerError)
                _logger.LogError(ex, "Unhandled exception.");
            else
                _logger.LogWarning("{Title}: {Message}", title, ex.Message);

            var problem = new ProblemDetails
            {
                Status = status,
                Title = title,
                // Internal errors keep their details out of the response body.
                Detail = status >= StatusCodes.Status500InternalServerError
                    ? "An unexpected error occurred."
                    : ex.Message,
                Type = $"https://httpstatuses.io/{status}"
            };

            problem.Extensions["traceId"] = context.TraceIdentifier;

            if (ex is ValidationException { Errors.Count: > 0 } validation)
                problem.Extensions["errors"] = validation.Errors;

            // Tell the caller exactly which ingredient ran out, not just that something did.
            if (ex is InsufficientStockException insufficientStock)
                problem.Extensions["shortages"] = insufficientStock.Shortages;

            context.Response.StatusCode = status;
            context.Response.ContentType = "application/problem+json";

            await context.Response.WriteAsJsonAsync(problem);
        }
    }

    private static (int Status, string Title) Classify(Exception ex) => ex switch
    {
        NotFoundException => (StatusCodes.Status404NotFound, "Resource not found"),
        InsufficientStockException => (StatusCodes.Status409Conflict, "Insufficient stock"),
        ConflictException => (StatusCodes.Status409Conflict, "Conflict"),
        ValidationException => (StatusCodes.Status400BadRequest, "Invalid request"),
        TenantResolutionException => (StatusCodes.Status400BadRequest, "Tenant not resolved"),
        DomainException => (StatusCodes.Status422UnprocessableEntity, "Business rule violated"),
        OperationCanceledException => (499, "Request cancelled"), // nginx-style client-closed
        _ => (StatusCodes.Status500InternalServerError, "Server error")
    };
}

public static class ExceptionHandlingMiddlewareExtensions
{
    public static IApplicationBuilder UseExceptionHandling(this IApplicationBuilder app)
        => app.UseMiddleware<ExceptionHandlingMiddleware>();
}
