# CI protocol: king quail Coturnix_chinensis_post.pretext.
#
# This runs on every push. It is not a curation of scientific interest; it is a
# protocol that exercises the operations a curator uses and then checks the
# assembly still holds together. CI runs it twice and compares the two AGP
# exports byte for byte, so a change that makes curation non-reproducible fails
# the build rather than being discovered in a manuscript.

assert contigs == 424
assert n50 > 50Mb

# Orientation.
invert SUPER_3

# Order.
move SUPER_4 after SUPER_1

# Grouping into a named chromosome.
scaffold create SUPER_1_chr
scaffold paint SUPER_1 SUPER_1_chr

# Rearranging must not create or destroy sequence.
assert contigs == 424
assert scaffolds == 1
assert n50 > 50Mb
