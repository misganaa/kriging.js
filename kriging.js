// Extend the Array class
Array.prototype.max = function() {
    return Math.max.apply(null, this);
};
Array.prototype.min = function() {
    return Math.min.apply(null, this);
};
Array.prototype.mean = function() {
    var i, sum;
    for(i=0,sum=0;i<this.length;i++)
	sum += this[i];
    return sum / this.length;
};
Array.prototype.rep = function(n) {
    return Array.apply(null, new Array(n))
    .map(Number.prototype.valueOf, this[0]);
};
Array.prototype.pip = function(x, y) {
    var i, j, c = false;
    for(i=0,j=this.length-1;i<this.length;j=i++) {
	if( ((this[i][1]>y) != (this[j][1]>y)) && 
	    (x<(this[j][0]-this[i][0]) * (y-this[i][1]) / (this[j][1]-this[i][1]) + this[i][0]) ) {
	    c = !c;
	}
    }
    return c;
}

var kriging = function() {
    var kriging = {};

    // Matrix algebra
    kriging_matrix_diag = function(c, n) {
	var i, Z = [0].rep(n*n);
	for(i=0;i<n;i++) Z[i*n+i] = c;
	return Z;
    };
    kriging_matrix_transpose = function(X, n, m) {
	var i, j, Z = Array(m*n);
	for(i=0;i<n;i++)
	    for(j=0;j<m;j++)
		Z[j*n+i] = X[i*m+j];
	return Z;
    };
    kriging_matrix_scale = function(X, c, n, m) {
	var i, j;
	for(i=0;i<n;i++)
	    for(j=0;j<m;j++)
		X[i*m+j] *= c;
    };
    kriging_matrix_add = function(X, Y, n, m) {
	var i, j, Z = Array(n*m);
	for(i=0;i<n;i++)
	    for(j=0;j<m;j++)
		Z[i*m+j] = X[i*m+j] + Y[i*m+j];
	return Z;
    };
    // Naive matrix multiplication
    kriging_matrix_multiply = function(X, Y, n, m, p) {
	var i, j, k, Z = Array(n*p);
	for(i=0;i<n;i++) {
	    for(j=0;j<p;j++) {
		Z[i*p+j] = 0;
		for(k=0;k<m;k++)
		    Z[i*p+j] += X[i*m+k]*Y[k*p+j];
	    }
	}
	return Z;
    };
    // Cholesky decomposition
    kriging_matrix_chol = function(X, n) { 
	var i, j, k, sum, p = Array(n);
	for(i=0;i<n;i++) p[i] = X[i*n+i];
	for(i=0;i<n;i++) {
	    for(j=0;j<i;j++)
		p[i] -= X[i*n+j]*X[i*n+j];
	    p[i] = Math.sqrt(p[i]);
	    for(j=i+1;j<n;j++) {
		for(k=0;k<i;k++)
		    X[j*n+i] -= X[j*n+k]*X[i*n+k];
		X[j*n+i] /= p[i];
	    }
	}
	for(i=0;i<n;i++) X[i*n+i] = p[i];

    };
    // Inversion of cholesky decomposition
    kriging_matrix_chol2inv = function(X, n) {
	var i, j, k, sum;
	for(i=0;i<n;i++) {
	    X[i*n+i] = 1/X[i*n+i];
	    for(j=i+1;j<n;j++) {
		sum = 0;
		for(k=i;k<j;k++)
		    sum -= X[j*n+k]*X[k*n+i];
		X[j*n+i] = sum/X[j*n+j];
	    }
	}
	for(i=0;i<n;i++)
	    for(j=i+1;j<n;j++)
		X[i*n+j] = 0;
	for(i=0;i<n;i++) {
	    X[i*n+i] *= X[i*n+i];
	    for(k=i+1;k<n;k++)
		X[i*n+i] += X[k*n+i]*X[k*n+i];
	    for(j=i+1;j<n;j++)
		for(k=j;k<n;k++)
		    X[i*n+j] += X[k*n+i]*X[k*n+j];
	}
	for(i=0;i<n;i++)
	    for(j=0;j<i;j++)
		X[i*n+j] = X[j*n+i];

    };

    // Variogram models
    kriging_variogram_gaussian = function(h, nugget, range, sill, A) {
	return nugget + ((sill-nugget)/range)*
	( 1.0 - Math.exp(-(1.0/A)*Math.pow(h/range, 2)) );
    };
    kriging_variogram_exponential = function(h, nugget, range, sill, A) {
	return nugget + ((sill-nugget)/range)*
	( 1.0 - Math.exp(-(1.0/A) * (h/range)) );
    };
    kriging_variogram_spherical = function(h, nugget, range, sill, A) {
	if(h>range) return sill;
	return nugget + ((sill-nugget)/range)*
	( 1.5*(h/range) - 0.5*Math.pow(h/range, 3) );
    };

    // Train using gaussian processes with bayesian priors
    kriging.train = function(t, x, y, model, sigma2, alpha) {
	var variogram = {
	    t      : t,
	    x      : x,
	    y      : y,
	    nugget : 0.0,
	    range  : 0.0,
	    sill   : 0.0,
	    A      : 1/3,
	    n      : 0
	};
	switch(model) {
	case "gaussian":
	    variogram.model = kriging_variogram_gaussian;
	    break;
	case "exponential":
	    variogram.model = kriging_variogram_exponential;
	    break;
	case "spherical":
	    variogram.model = kriging_variogram_spherical;
	    break;
	};

	// Lag distance/semivariance
	var i, j, k, l, n = t.length;
	var distance = Array((n*n-n)/2);
	for(i=0,k=0;i<n;i++)
	    for(j=0;j<i;j++,k++) {
		distance[k] = Array(2);
		distance[k][0] = Math.pow(
		    Math.pow(x[i]-x[j], 2)+
		    Math.pow(y[i]-y[j], 2), 0.5);
		distance[k][1] = Math.abs(t[i]-t[j]);
	    }
	distance.sort();
	variogram.range = distance[(n*n-n)/2-1][0];

	// Bin lag distance
	var lags = ((n*n-n)/2)>30?30:(n*n-n)/2;
	var tolerance = variogram.range/lags;
	var lag = [0].rep(lags);
	var semi = [0].rep(lags);
	for(i=0,j=0,k=0,l=0;i<lags&&j<((n*n-n)/2);i++,k=0) {
	    while( distance[j][0]<=((i+1)*tolerance) ) {
		lag[l] += distance[j][0];
		semi[l] += distance[j][1];
		j++;k++;
		if(j>=((n*n-n)/2)) break;
	    }
	    if(k>0) {
		lag[l] /= k;
		semi[l] /= k;
		l++;
	    }
	}
	if(l<2) return variogram; // Error: Not enough points

	// Feature transformation
	n = l;
	variogram.range = lag[n-1]-lag[0];
	var X = [1].rep(2*n);
	var Y = Array(n);
	var A = variogram.A;
	for(i=0;i<n;i++) {
	    switch(model) {
	    case "gaussian":
		X[i*2+1] = 1.0-Math.exp(-(1.0/A)*Math.pow(lag[i]/variogram.range, 2));
		break;
	    case "exponential":
		X[i*2+1] = 1.0-Math.exp(-(1.0/A)*lag[i]/variogram.range);
		break;
	    case "spherical":
		X[i*2+1] = 1.5*(lag[i]/variogram.range)-
		    0.5*Math.pow(lag[i]/variogram.range, 3);
		break;
	    };
	    Y[i] = semi[i];
	}

	// Least squares
	var Xt = kriging_matrix_transpose(X, n, 2);
	Z = kriging_matrix_multiply(Xt, X, 2, n, 2);
	Z = kriging_matrix_add(Z, kriging_matrix_diag(1/alpha, 2), 2, 2);
	kriging_matrix_chol(Z, 2);
	kriging_matrix_chol2inv(Z, 2);
	var W = kriging_matrix_multiply(kriging_matrix_multiply(Z, Xt, 2, 2, n), Y, 2, n, 1);

	// Variogram parameters
	variogram.nugget = W[0];
	variogram.sill = W[1]*variogram.range+variogram.nugget;
	variogram.n = x.length;

	// Gram matrix with prior
	n = x.length;
	var K = Array(n*n);
	for(i=0;i<n;i++) {
	    for(j=0;j<i;j++) {
		K[i*n+j] = variogram.model(Math.pow(Math.pow(x[i]-x[j], 2)+
						    Math.pow(y[i]-y[j], 2), 0.5),
					   variogram.nugget, 
					   variogram.range, 
					   variogram.sill, 
					   variogram.A);
		K[j*n+i] = K[i*n+j];
	    }
	    K[i*n+i] = variogram.model(0, variogram.nugget, 
				       variogram.range, 
				       variogram.sill, 
				       variogram.A);
	}

	// Inverse penalized Gram matrix projected to target vector
	C = kriging_matrix_add(K, kriging_matrix_diag(sigma2, n), n, n);
	kriging_matrix_chol(C, n);
	kriging_matrix_chol2inv(C, n);
	var M = kriging_matrix_multiply(C, t, n, n, 1);
	variogram.M = M;

	return variogram;
    };

    // Model prediction
    kriging.predict = function(x, y, variogram) {
	var i, K = Array(variogram.n);
	for(i=0;i<variogram.n;i++)
	    K[i] = variogram.model(Math.pow(Math.pow(x-variogram.x[i], 2)+
					    Math.pow(y-variogram.y[i], 2), 0.5),
				   variogram.nugget, variogram.range, 
				   variogram.sill, variogram.A);
	return kriging_matrix_multiply(K, variogram.M, 1, variogram.n, 1);
    };

    // Mapping methods
    kriging.grid = function(canvas, polygons, bbox, variogram) {
	
    }

    return kriging;
}();