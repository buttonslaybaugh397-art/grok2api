package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

var defaultCORSAllowHeaders = strings.Join([]string{
	"Authorization",
	"Content-Type",
	"X-Requested-With",
	"Accept",
	"Origin",
	"X-API-Key",
	"X-Request-ID",
}, ", ")

var defaultCORSAllowMethods = strings.Join([]string{
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"HEAD",
}, ", ")

// CORS enables browser access for the standalone studio and other cross-origin clients.
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin == "" {
			origin = "*"
		}

		// Reflect the request origin so credentialed browser calls remain valid.
		c.Header("Access-Control-Allow-Origin", origin)
		if origin != "*" {
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
		}

		requestHeaders := strings.TrimSpace(c.GetHeader("Access-Control-Request-Headers"))
		if requestHeaders != "" {
			c.Header("Access-Control-Allow-Headers", requestHeaders)
		} else {
			c.Header("Access-Control-Allow-Headers", defaultCORSAllowHeaders)
		}

		c.Header("Access-Control-Allow-Methods", defaultCORSAllowMethods)
		c.Header("Access-Control-Expose-Headers", "X-Request-ID, Content-Type")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	}
}
